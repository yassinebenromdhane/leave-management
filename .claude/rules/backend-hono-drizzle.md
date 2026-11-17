---
paths:
  - "server/**"
  - "docker-compose.yml"
  - "Dockerfile"
  - "Caddyfile"
---

# server/: Hono + Drizzle + Better Auth

## Route tree

- `/api/operator/*`: operator role only (`requireOperator` middleware). Employees, leaves, settings, reports.
- `/api/me/*`: employee role only (`requireEmployee`). Every handler reads `employeeId` from the session, **never** from params, query or body.
- `/api/events`: SSE stream (`streamSSE`). Operator subscribes to the operator channel, employees to `employee:<id>`.
- `/api/files/*`: upload and download with a per-request access check. Files are never served statically.
- `/api/auth/*`: Better Auth handler.
- `app.ts` chains routes and `export type AppType = typeof app` for `hono/client`. Keep routes chained (`app.route(...)`) so types flow.
- Hono serves the built `web/dist` for every non-`/api` path (SPA fallback to `index.html`, including `/me/*` and `/leave/:id`).

## Handlers stay thin

A handler validates with `zValidator('json' | 'query' | 'param', schemaFromShared)`, calls one function in `src/domain/`, and returns JSON. Business logic, transactions and event publishing live in `domain/` (`leaveService`, `conflictChecker`, `ledgerService`, `audit`), never in routes.

## Database (Drizzle 0.45, PostgreSQL)

- Schema in `src/db/schema.ts` only. Migrations come from `pnpm --filter @leave/server db:generate`. Never hand-edit `server/drizzle/`, never `drizzle-kit push`. Use `/add-migration`.
- Day amounts: `numeric(6,1)`. Drizzle returns `numeric` as a string, so convert through one helper (`toDays()` / `fromDays()`), never `parseFloat` inline.
- Calendar dates: `date` columns with `mode: 'string'`. Timestamps: `timestamptz`.
- Enums: `pgEnum` built from the `as const` arrays exported by `@leave/shared`.
- `ledger_entry`: unique index on `(employee_id, leave_type_id, entry_type, period_key)`. Postgres treats NULLs as distinct, so leave and reversal rows (null `period_key`) never collide, while accrual (`YYYY-MM`) and year-end rows stay idempotent. Use `onConflictDoNothing` for accrual runs.
- **Append-only ledger:** no `update(ledgerEntry)` / `delete(ledgerEntry)`. The guard hook blocks it.
- Soft deletes: `leave_request.deleted_at`, `employee.status`. Every read filters `deleted_at IS NULL` through a shared query helper.
- Balance queries: `SUM(days) WHERE employee_id = ? AND leave_type_id = ? AND effective_date <= ?`. Reserved = `SUM(working_days)` of `status = 'pending' AND deleted_at IS NULL`.

## Transactions (`db.transaction`)

These must be one transaction each:
- **Submit / create:** recompute `workingDays` with `@leave/shared` → run blocking checks → insert `leave_request` (snapshot `working_days`, `has_warning`) → if approved, insert `leave` ledger entry → `notification` → `audit_log`.
- **Approve:** `SELECT … FOR UPDATE` the request, require `status = 'pending'` → insert `leave` entry of `-working_days` dated `start_date` → set `decided_at` → notification → audit.
- **Reject / cancel an approved leave:** status change + `reversal` entry (+ working_days) + audit.
- **Edit dates of an approved leave:** reversal of the old amount + new `leave` entry + updated request + audit.
- **Withdraw (portal):** status check inside the transaction. If the operator already decided, return `409` with an i18n key. The first writer wins (spec 4.3 sync rule 6).
- Publish SSE events **after commit**, never inside the transaction.

## Conflict checks (spec 1.3)

`conflictChecker` returns `{ blocking: Issue[], warnings: Issue[] }`, with a stable `code` and i18n params for each issue. It runs on every create, edit and submit, and its result decides `has_warning`.
- Blocking: self-overlap (non-deleted pending or approved), zero working days, outside `hire_date` / `end_date`, and negative balance when `allow_negative` is false or the result goes below `-negative_limit_days`.
- Warning: same-department colleague off, negative balance (when allowed), required attachment missing. Minimum staffing is V2.
- Portal differences (spec 1.7): a negative balance is a warning the employee must acknowledge (`acknowledgeNegative: true`). A missing attachment is allowed for sick leave (flag "certificate expected") and blocked for other types that require one.

## Auth (Better Auth + Argon2id)

- Public sign-up is **disabled**. Accounts are created by operator invite only (set-password link valid 48 h) or with an operator-issued temporary password (`must_change_password = true`, login by employee code).
- Custom hashing hook uses Argon2id. Password rules: minimum 8 characters, rejected if on the bundled common-password list, no composition or rotation rules.
- Lockout: 5 failed attempts → `locked_until = now + 15 min`. Login errors are generic and **never reveal whether the email exists**. The same generic response also covers a locked account.
- Sessions: "Keep me signed in" = 30 days; otherwise 12 h and a browser-session cookie. Password change and the operator's "sign out everywhere" revoke all sessions. Archiving an employee or disabling portal access revokes sessions immediately.
- Reset link: 30 min, single use, token stored hashed.
- Confirm option names against the installed Better Auth version's docs. Do not guess an API.

## Other services

- `services/email.ts`: Nodemailer over SMTP (Brevo), settings from env, templates in fr and en chosen by employee locale. Email failures never roll back a business transaction: log them and record them on `notification`.
- `services/fileStorage.ts`: `FileStorage` interface + `LocalDiskStorage`. Check PDF / JPG / PNG by magic bytes plus MIME, max 10 MB, random `storage_key`, path outside the web root, no user-supplied path segments.
- `services/exports/`: XLSX (ExcelJS: frozen header, column widths, numeric cells) and CSV (csv-stringify, **UTF-8 BOM**, separator and decimal mark from `company_settings.locale`). Payroll uses `monthSplit` from shared.
- `realtime/bus.ts`: an in-memory `EventEmitter`, one process. Event payloads carry ids only (`{ type, leaveRequestId, employeeId }`), never balances or PII.

## Audit

`domain/audit.ts` writes `audit_log(entity, entity_id, action, before_json, after_json)` inside the same transaction as every mutation. A mutation without an audit row is a bug.

## Tests

Vitest integration tests run against a real PostgreSQL (the docker `db` service or a throwaway schema), never mocks for ledger and transaction behaviour. Each test cleans up after itself.
