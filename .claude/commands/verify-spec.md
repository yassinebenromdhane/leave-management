---
description: Audit the codebase against the functional spec, covering the 12 tables, the 9 calculation rules, the conflict matrix, portal privacy boundaries, sync rules and the MVP scope, and report the gaps
argument-hint: "[area: data | rules | conflicts | portal | ui | all]  (default: all)"
allowed-tools: Read, Glob, Grep, Bash, Skill, Agent
---

# Verify against the spec

Scope: $ARGUMENTS (default `all`). This is a **read-only audit**: do not edit files. Load `ledger-and-calculation-engine` and `portal-privacy-and-sse-sync` first.

Run the test suite once (`pnpm test`) and use the results as evidence. For each item, mark ✅ implemented and tested · 🟡 implemented, untested or partial · ❌ missing or wrong · ⏭ V2 (not expected). Cite `file:line` as evidence.

## A. Data model (spec 4.1), in `server/src/db/schema.ts`

Check every table and key field: `company_settings` (single row; `work_days` bitmask, `leave_year_start_month`, `allow_negative`, `negative_limit_days`, `default_save_status`, `locale`), `department` (`min_staffing` nullable), `employee` (`employee_code`, `portal_access`, `hire_date`, `end_date`, `work_days_override`, `status`), `leave_type` (`is_paid`, `deducts_balance`, `day_count_mode`, `requires_attachment`, `annual_cap_days`, `is_active`), `leave_policy` (`effective_from`, versioned rows), `leave_request` (halves, `working_days` snapshot, `has_warning`, `source`, `submitted_at`, `decided_at`, `deleted_at`), `ledger_entry` (7 entry types, signed `numeric(6,1)`, **unique (employee_id, leave_type_id, entry_type, period_key)**), `holiday` (`is_half_day`, `is_confirmed`, `source`), `attachment`, `audit_log` (jsonb before/after), `notification`, and the auth tables replacing `portal_account` (with the lockout and must-change fields). `period_lock` should be absent (V2).
Also check: no `balance` column anywhere; migrations in `server/drizzle/` match the schema (`pnpm --filter @leave/server db:generate` produces no diff; run it only with the user's OK, since it writes files).

## B. Calculation rules (spec 4.2), one row per rule 1–9

For each rule: the implementation location (must be `shared/src/rules/` for 1, 2, 3, 9), its tests, and whether the server calls the shared function, not a copy. Grep `server/` and `web/` for re-implementations (date loops, `getDay()`, weekend checks outside shared). Confirm there is no `update`/`delete` on `ledgerEntry`, reversal-based edits run in one transaction, accrual is idempotent, and `monthSplit` has the sum property test.

## C. Conflicts (spec 1.3 + portal table in 1.7)

A matrix of each check × operator severity × portal behaviour × test present. Include the `allow_negative` toggle, the sick-leave attachment exception, and `has_warning` persistence.

## D. Portal privacy and sync (spec 4.3)

- Every `/api/me` handler: where does `employeeId` come from? List them all.
- Teammate projection columns, approved-only filter, scope setting.
- Withdraw allowed only while pending; the withdraw/approve race returns 409.
- Sync rules 1–6: event names, published after commit, ids-only payloads, client invalidates rather than patches, 30 s polling fallback.

## E. UI and UX (spec 2.x), MVP items only

The layout zones and widths, drawer routes `/leave/:id`, shortcuts table and the text-field gating, Undo 6 s, KPI cards as filters, status pill dot + label, solid/hatched, empty-state copy, the < 768 px agenda, portal tabs, 44 px targets, i18n parity (diff the key sets of `fr.json` and `en.json`).

## F. Scope creep

Flag anything built that `CLAUDE.md` lists as V2, or anything out of scope (approval chains, manager roles, multi-company, hourly leave).

## Report

1. A summary scorecard per area (counts of ✅/🟡/❌).
2. A ranked list of ❌ and 🟡 items, each with the spec clause, the evidence, and a one-line fix.
3. Open spec questions the code had to answer (country preset, accrual rounding) and how they were answered.
