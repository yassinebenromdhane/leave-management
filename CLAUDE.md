# Leave Management Micro-App

One operator manages every leave for one company (5–150 employees) from a single screen, logging a leave in under 10 seconds. Employees use a small mobile-first self-service portal at `/me` to check balances and request leave. **Everything serves that sentence.** Anything that needs an approval chain, a manager role, or a second company is out of scope.

Source documents (the authority when this file is silent):
- `Leave Management Micro-App — Functional Specification with employee portal.pdf` (15 Nov 2026), cited below as **spec §x.y**
- `leave-app-tech-stack.md`, cited below as **stack §x**

## Stack (do not substitute)

| Layer | Choice |
| --- | --- |
| Monorepo | pnpm workspaces: `shared` (`@leave/shared`), `server` (`@leave/server`), `web` (`@leave/web`) |
| Frontend | React + TypeScript (Vite), Tailwind CSS + shadcn/ui, TanStack Query, React Router, react-i18next (fr + en) |
| API | Hono 4.x on Node.js LTS, TypeScript, `@hono/zod-validator`, typed client via `hono/client` |
| Database | PostgreSQL + Drizzle ORM **pinned to the 0.45 line** (1.0 is an RC; do not upgrade) + Drizzle Kit migrations |
| Auth | Better Auth (email + password, cookie sessions, Drizzle adapter), Argon2id hashing |
| Real-time | SSE via Hono `streamSSE` + in-process event emitter; browser `EventSource`; 30 s polling fallback |
| Files | Local disk volume behind a `FileStorage` interface; downloads only via an access-checked API route |
| Email | Brevo over SMTP, sent with Nodemailer |
| Exports | ExcelJS (XLSX), csv-stringify (CSV, UTF-8 BOM), pdfmake (V2 only) |
| Dates | date-fns, shared front and back |
| Jobs (V2) | croner, in-process |
| Tests | Vitest |
| Hosting | One VPS, Docker Compose (app + postgres + caddy), Caddy auto-HTTPS, nightly `pg_dump` + uploads copy |

## Commands

The repo is scaffolded by `/scaffold-mvp`. These script names are the contract; keep them when scaffolding.

```bash
pnpm install                          # install all workspaces
docker compose up -d db               # local PostgreSQL
pnpm dev                              # server (Hono, watch) + web (Vite) together
pnpm build                            # build web, bundle server
pnpm typecheck                        # tsc --noEmit in every workspace
pnpm lint                             # ESLint (flat config at repo root)
pnpm test                             # Vitest in every workspace
pnpm --filter @leave/shared test      # rules only: run this first, always
pnpm --filter @leave/server db:generate   # drizzle-kit generate (SQL migration from schema.ts)
pnpm --filter @leave/server db:migrate    # drizzle-kit migrate
pnpm --filter @leave/server db:seed       # leave types, holiday preset, first operator
```

Never run `drizzle-kit push` (it bypasses migrations) or `docker compose down -v` (it deletes the database volume).

## Hard architectural invariants

Break one of these only if the user explicitly asks, and say so in your reply.

1. **Balances are never stored.** Balance = `SUM(ledger_entry.days)` with `effective_date <= date`. Available = balance − reserved (pending `working_days`). No `balance` column anywhere, no client-side subtraction after a mutation.
2. **`ledger_entry` is append-only.** Never `UPDATE` or `DELETE` it. Corrections are `reversal` entries. An approved-leave date edit = reversal of the old amount + new `leave` entry, **in one transaction**.
3. **Rules live once, in `shared/`.** `workingDays`, `balance`, `monthSplit` and all Zod schemas are in `shared/src`. The browser calls them for live previews; the server calls the same functions as the final authority and stores the server's result. Never reimplement a rule in `server/` or `web/`.
4. **`shared/` is pure TypeScript.** No Hono, React, Drizzle, Node built-ins, or I/O. Only `zod` and `date-fns`.
5. **Portal isolation.** Every `/api/me/*` query is filtered by the session's `employeeId`, never by an id from the URL, query or body. Teammate data is an **"Away" projection only** (`employeeId`, `fullName`, `startDate`, `endDate`, half-day flags) of **Approved** leaves; type, note, status and attachments are dropped on the server.
6. **Every mutation writes `audit_log`** (`before_json` / `after_json`) in the same transaction as the change.
7. **Days are 0.5-step decimals.** Store as `numeric(6,1)`; compute in shared code as integer half-day units; never use floating-point accumulation for day totals.
8. **Warn, don't block.** Only impossible data is blocked: end before start, self-overlap, zero working days, outside employment period, and negative balance when `allow_negative` is off. Everything else is a warning the operator can save through (sets `has_warning`).
9. **Soft delete only.** `leave_request.deleted_at`, `employee.status = archived`. Archiving cuts portal access immediately.
10. **Boundaries in `web/`.** `web/src/operator/` and `web/src/portal/` never import each other. Shared UI goes in `web/src/common/`, whose components take data through props and never fetch. `web` imports from `@leave/server` only as `import type { AppType }`.
11. **Real-time events are signals, not data.** On `leave.submitted` / `leave.decided` the client invalidates TanStack Query keys and refetches.
12. **All UI strings go through i18next** (`fr.json` and `en.json` both updated in the same change). Arabic/RTL is deferred.

## Data model (spec §4.1)

MVP tables: `company_settings` (single row), `department`, `employee`, `leave_type`, `leave_policy` (new row per rule change), `leave_request` (`working_days` snapshotted at save), `ledger_entry` (append-only, unique on `(employee_id, leave_type_id, entry_type, period_key)`), `holiday`, `attachment`, `audit_log`, `notification`, plus auth. Per stack §2, **Better Auth's `user` / `session` / `account` / `verification` tables replace `portal_account`**. The spec's lockout and first-login fields (`must_change_password`, `failed_attempts`, `locked_until`, `employee_id`, `role`) are added to the Better Auth user as additional fields. `period_lock` is V2.

Enumerations:
- leave status: `pending | approved | rejected | cancelled`
- ledger `entry_type`: `opening | accrual | leave | adjustment | carryover | expiry | reversal`
- half: `full | am | pm`; `source`: `operator | portal`; `day_count_mode`: `working | calendar`
- events: `leave.submitted`, `leave.decided` (plus `leave.changed`, `leave.withdrawn` for the sync table in spec §1.7)

See the `ledger-and-calculation-engine` skill for the nine calculation rules.

## MVP vs V2 (spec §3.1)

Build only MVP unless the user asks for V2. V2 = bulk CSV import, seniority tiers, per-employee part-time patterns, typed date ranges, multiple attachments, recurring absences, minimum staffing, ghost bar, Quarter/Year zoom, drag create/resize, compact density, automatic accrual and year-end jobs, PDF exports, period lock, command palette, dark theme, hover cards, audit-log viewer, PWA/push, kiosk mode, `.ics` feed, digests. In the MVP, accrual runs from a manual **"Run accrual"** button.

## Open questions: do not invent answers

- **Country preset: Tunisia** (decided with the operator, Nov 2026). Fixed public holidays are seeded; lunar ones are seeded as unconfirmed estimates. The paid-leave default (22 days/year, earned monthly) is the operator's figure: keep it an editable default and never present a rate as Tunisian law.
- **Accrual rounding** (decided Nov 2026): policy `rate_days` is **days per leave year** in both modes. Monthly mode credits cumulatively within the leave year: `roundAccrual(earned to date) − roundAccrual(earned before)`, half-up to 0.5, so 22/year gives 2, 1.5, 2… and exactly 22.0. Partial months earn by calendar days (≈ 0.06/day). All in `shared/src/rules/accrual.ts`.
- Email: Brevo SMTP is decided (stack §1). Treat provider settings as env vars only.

## Where to look

- Path-scoped rules: `.claude/rules/` (shared, server, web)
- Domain skills: `.claude/skills/` (ledger engine, portal privacy + SSE, operator UI, mobile portal UI)
- Sub-agents: `.claude/agents/`; workflows: `/scaffold-mvp`, `/implement-feature`, `/verify-spec`, `/add-migration`
- Guard hooks: `.claude/hooks/`. They block invariant violations before a write and run lint, typecheck and related tests after one. They do nothing until `node_modules` exists.

## Working conventions

- Order of work for any feature: **shared schema + rule + Vitest → server route/service → web UI → i18n → tests green**.
- Write the Vitest test before or with any change to `shared/src/rules/`.
- Dates are calendar dates (`YYYY-MM-DD` strings / Postgres `date`), never JS `Date` at midnight local. Tests run with `TZ=UTC`.
- Secrets live in `.env` (never committed, never read into the conversation). Keep `.env.example` current.
