---
description: Safely change the Drizzle schema, generate and review the SQL migration, apply it locally, and verify seeds and tests
argument-hint: "<schema change, e.g. 'add min_staffing to department' or 'notification.read_at index'>"
---

# Add a migration

Change: **$ARGUMENTS**

Never hand-edit files in `server/drizzle/`, and never run `drizzle-kit push`. The guard hook and the permission deny list enforce both.

## 1. Check the change against the spec

- Confirm it matches spec 4.1 (or is a justified addition) and does not break an invariant: no stored balance, ledger append-only, soft deletes, `numeric(6,1)` for days, `date` (string mode) for calendar dates, `timestamptz` for instants.
- Enum changes: update the `as const` array in `shared/src/types.ts` **first**, then the `pgEnum` built from it.
- Is the change **destructive** (dropping or renaming a column, narrowing a type, adding `NOT NULL` without a default to a table with rows)? If so, stop and propose an expand → backfill → contract sequence across two migrations, and get the user's confirmation.

## 2. Edit the schema

Edit `server/src/db/schema.ts` only. Conventions:
- snake_case column names, camelCase TS properties; `id` uuid default `gen_random_uuid()`; `created_at` / `updated_at` `timestamptz default now()`.
- Foreign keys with explicit `onDelete` (`restrict` for ledger and request history; nothing cascades into `ledger_entry` or `audit_log`).
- Keep the ledger unique index `(employee_id, leave_type_id, entry_type, period_key)`.
- Add indexes for the hot paths: `ledger_entry(employee_id, leave_type_id, effective_date)`, `leave_request(employee_id, start_date, end_date) WHERE deleted_at IS NULL`, `leave_request(status) WHERE deleted_at IS NULL`.

## 3. Generate and review

```bash
pnpm --filter @leave/server db:generate
```

Open the new SQL file and review it line by line. Show the user the SQL with a one-line explanation per statement, and flag any `DROP`, `ALTER … TYPE`, or table rewrite. If drizzle-kit asks an interactive rename-vs-create question, stop and ask the user. Do not guess.

## 4. Apply locally

```bash
docker compose up -d db
pnpm --filter @leave/server db:migrate
```

## 5. Update the seeds and verify

- Update `server/src/db/seed.ts` if the change needs defaults (new leave-type flag, settings column). The seed must stay **idempotent** (upserts / `onConflictDoNothing`).
- Run `pnpm --filter @leave/server db:seed` twice; the second run must change nothing.
- Update the affected Zod schemas in `shared/` and the API response shapes.
- `pnpm typecheck && pnpm test`.

## 6. Report

The migration file name, the SQL summary, whether it is destructive or reversible, seed changes, tests run (pass/fail counts), and any follow-up (backfill, contract step).
