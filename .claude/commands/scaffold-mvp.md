---
description: Bootstrap the leave app MVP step by step, following stack doc section 4 (skeleton + deploy, auth, shared rules + leave logging, operator workspace + exports, portal + live sync)
argument-hint: "[step 1-5 | all]  (default: next unfinished step)"
---

# Scaffold the MVP

Target: $ARGUMENTS (if empty, detect the first unfinished step below and do only that one).

Read `CLAUDE.md` first. Work **one step at a time**. At the end of each step, run the verification, show the result, and stop for the user's go-ahead before the next step. Use the `backend-architect`, `frontend-builder` and `domain-test-engineer` agents where they fit; run independent work in parallel.

Detect progress from the repo: `pnpm-workspace.yaml` → step 1 started; `server/src/auth/auth.ts` → step 2; `shared/src/rules/workingDays.ts` + `server/src/domain/leaveService.ts` → step 3; `web/src/operator/workspace/Timeline.tsx` + `server/src/services/exports/` → step 4; `web/src/portal/RequestSheet.tsx` + `server/src/routes/events.ts` → step 5.

## Step 1: skeleton and first deploy

1. Check `node --version` (LTS) and that pnpm is present. If pnpm is missing, tell the user to run `corepack enable` (do not install global tools yourself).
2. Create the root `package.json` (private, `packageManager` pinned), `pnpm-workspace.yaml` (`shared`, `server`, `web`), `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`), `eslint.config.mjs` (typescript-eslint), `.gitignore` (`node_modules`, `dist`, `.env*` except `.env.example`, `uploads/`), `.env.example`.
3. Root scripts: `dev`, `build`, `typecheck`, `lint`, `test` (all `pnpm -r --if-present …`), exactly as named in `CLAUDE.md`.
4. `shared/` (`@leave/shared`): zod, date-fns, vitest; `src/types.ts` with the enum arrays from `CLAUDE.md`; `src/index.ts`.
5. `server/` (`@leave/server`): hono 4.x, `@hono/node-server`, `@hono/zod-validator`, `drizzle-orm@0.45.x`, `drizzle-kit` (matching), `postgres` driver, vitest, tsx. Scripts: `dev`, `build`, `typecheck`, `test`, `db:generate`, `db:migrate`, `db:seed`. Declare **all MVP tables** in `src/db/schema.ts` (see the `/add-migration` command for the conventions); generate and apply the first migration.
6. Seed: the five leave-type presets (paid, sick, unpaid, special, compensatory rest) with palette colours; one **placeholder** country holiday list marked `TODO(spec-open-question)`; company settings defaults (Mon–Fri, leave year start month 1, `default_save_status = approved`, `allow_negative = false`).
7. `web/` (`@leave/web`): Vite React TS, Tailwind, shadcn/ui init, TanStack Query, React Router, react-i18next with `fr.json`/`en.json`; routes `/` and `/me/*` as lazy placeholders; `hono/client` wired with `import type { AppType }`.
8. `Dockerfile` (build web → copy into server image → one Node process), `docker-compose.yml` (app, postgres with a named volume and **no public port**, caddy), `Caddyfile` (domain from env, reverse proxy to app).
9. **Verify:** `pnpm install && pnpm typecheck && pnpm test && pnpm build`; `docker compose up -d db` then `db:migrate` and `db:seed`. Deploying to the VPS needs the user's server and DNS; give them the exact commands rather than running them.

## Step 2: login and roles

Better Auth with the Drizzle adapter, Argon2id hashing, roles `operator | employee`, additional user fields (`employeeId`, `mustChangePassword`, `failedAttempts`, `lockedUntil`), public sign-up disabled, seeded operator account (credentials from env), `requireOperator` / `requireEmployee` middleware, lockout (5 attempts / 15 min, generic errors), the common-password check, invite (48 h) and reset (30 min) emails through Nodemailer + Brevo SMTP, and login by employee code + forced password change. Login screens for both surfaces.
**Verify:** integration tests for lockout, no enumeration, disabled sign-up, session revocation. Then run the `security-privacy-auditor` agent on the auth code.

## Step 3: shared rules and leave logging

Tests first: `workingDays`, `balance`, `monthSplit` in `shared/` (load `ledger-and-calculation-engine`; delegate to `domain-test-engineer`). Then `leaveService` (create / approve / reject / cancel / edit, ledger + audit in one transaction), `conflictChecker`, the employee table with balance columns, quick add, inline edit, opening balance, manual adjustment with mandatory note, archive, the employee drawer with ledger, and the leave drawer with live count, balance preview, conflict strip, attachment, `C` and `Ctrl+Enter` / `Shift+Ctrl+Enter`.
**Verify:** `pnpm test`; the 10-second logging walkthrough described in `operator-command-ui`.

## Step 4: operator workspace and exports

Month and Week timeline, KPI cards as filters, Who's out panel, List view with bulk approve, Settings tabs (company, leave types, accrual with the **"Run accrual"** button, public holidays), Reports with the monthly payroll summary and leave detail in XLSX + CSV (UTF-8 BOM, locale separators), the top-bar Export, Undo toasts, empty states, the < 768 px agenda layout.
**Verify:** an export opens cleanly in Excel (check the BOM and separators in a test); `/verify-spec` passes for modules 1.1–1.6.

## Step 5: employee portal and live sync

`/me`: Home, RequestSheet, My leaves, Team (load `mobile-portal-ui`); `/api/me/*` routes (load `portal-privacy-and-sse-sync`); `/api/events` SSE + bus + `useLeaveEvents`; decision emails; finish the fr/en strings; nightly backup script (`pg_dump` + uploads copy) referenced from the compose docs; a mobile test pass.
**Verify:** `pnpm test`, then `/verify-spec`, then the `security-privacy-auditor` agent. Report the full MVP checklist from `CLAUDE.md` § MVP vs V2.
