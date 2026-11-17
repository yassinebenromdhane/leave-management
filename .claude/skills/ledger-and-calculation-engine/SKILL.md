---
name: ledger-and-calculation-engine
description: Spec 4.2 calculation rules for the leave app. Covers working-day counting with half days and holidays, 0.5-day units, the append-only balance ledger (accrual, leave, reversal, adjustment, carryover, expiry), reserved and available balance, approval and edit ledger writes, monthly accrual idempotency, year-end carryover, holiday-change recalculation and payroll month split. Use when writing or changing shared/src/rules, ledger writes in server/src/domain, balance displays, accrual, exports, or any day-count number.
---

# Ledger and calculation engine

The only derived values in the system are **day counts** and **balances**. Both are computed, never typed in and never stored as a running total. One implementation lives in `shared/src/rules/`. The browser uses it for previews; the server reruns it and stores its own result.

## Units

- Smallest unit is **0.5 day**. Compute in integer half-units; expose `number` days where `x * 2` is an integer.
- DB: `numeric(6,1)`. Ledger `days` is signed: `+` grants, `−` consumption.
- Hourly leave is out of scope. Do not add hours.

## Rule 1: working days (`workingDays.ts`)

```ts
workingDays({
  start: IsoDate, end: IsoDate,
  startHalf: 'full' | 'am' | 'pm', endHalf: 'full' | 'am' | 'pm',
  mode: 'working' | 'calendar',
  workDays: WeekMask,                 // employee override ?? company pattern
  holidays: { date: IsoDate; isHalfDay: boolean }[],
}): { days: number; weekendDays: number; holidayDays: number }
```

For each date from start to end inclusive:
- `calendar` mode: every date counts 1.
- `working` mode: 0 if the weekday is not in the pattern; else 0 if it is a full holiday; 0.5 if it is a half-day holiday; else 1.

Then subtract 0.5 if the first day is **afternoon-only** (`startHalf = 'pm'`) and 0.5 if the last day is **morning-only** (`endHalf = 'am'`).

Return the excluded counts so the UI can print **"4.5 working days (1 weekend, 1 public holiday excluded)"**.

Interpretations to keep (state them in tests; the spec does not cover them):
- Single-day leave (`start === end`): `full` = 1, `am` or `pm` = 0.5. Store `startHalf = endHalf`. A `pm` start with an `am` end on the same day is impossible data → blocking.
- Multi-day: the first day may be `full | pm` and the last day `full | am`. Other combinations leave a gap and are rejected by the shared Zod schema.
- Never let a single day's contribution go below 0. Example: a half-day holiday on a `pm` start day contributes 0, not −0.5. Add a test.
- Half-day adjustments apply in calendar mode too.
- `days === 0` → blocking "No working days in this range".

## Rule 2: balance (`balance.ts`)

`balance(entries, employeeId, leaveTypeId, onDate) = Σ entry.days where effective_date <= onDate`.

## Rule 3: reserved and available

`reserved = Σ working_days of that employee and type's Pending, non-deleted requests`.
`available = balance − reserved`. This is shown everywhere ("taken 8 · pending 2") and **never written to the ledger**.

## Rule 4: approval

Approve → one `leave` entry, `days = −working_days`, `effective_date = start_date`, `leave_request_id` set.
Reject or cancel **an approved leave** → one `reversal` entry `+working_days` linked to the same request. Rejecting or cancelling a *pending* request writes nothing (it only stops being reserved). Nothing is deleted.

## Rule 5: edits

Changing the dates or halves of an approved leave, in **one transaction**: `reversal` of the old snapshot amount → recompute `working_days` → new `leave` entry → update the request → audit.

## Rule 6: monthly accrual

`+rate_days` per active employee, type and month, `entry_type = 'accrual'`, `period_key = 'YYYY-MM'`. Prorate the hire month by days employed when `prorate_hire_month` is on. Nothing after `end_date`. Idempotent through the unique key `(employee_id, leave_type_id, entry_type, period_key)` plus `onConflictDoNothing`. MVP: triggered by a manual **"Run accrual"** button. V2: croner job on the 1st, with a one-click revert that writes reversals.
⚠ The spec does not say how to round prorated values to 0.5. Keep a single `roundAccrual()` and flag the choice to the user.
Use the `leave_policy` row whose `effective_from` applies to the accrual month (a new policy row on each rule change keeps history correct).

## Rule 7: year-end (V2 job, rule defined now)

`carryover = min(remaining, cap)` → `carryover` entry. The remainder → negative `expiry` entry. Carried days expire on `carryover_expiry_month_day` if unused, oldest days consumed first (FIFO). `period_key` = leave-year label, which makes the run idempotent.

## Rule 8: holiday changes

Adding or moving a holiday recomputes `working_days` for **Pending and future Approved** leaves that include the date. List the affected leaves for operator confirmation. On confirm: pending requests update their snapshot; approved ones go through rule 5 (reversal + new entry). The employee sees a "changed by HR" note.

## Rule 9: month split for payroll (`monthSplit.ts`)

Allocate each leave day by day with rule 1's per-day values, including the half-day edge adjustments on the actual first and last day. Group by `YYYY-MM`. Invariant: `Σ months === workingDays(leave)`. Property-test it.

## Other ledger entry types

- `opening`: set once at employee creation for pre-existing staff.
- `adjustment`: operator ± days, leave type, effective date, **mandatory note**. Never overwrites a number.
- Only types with `deducts_balance = true` write `leave` entries. Unpaid or non-deducting types still count days for payroll.

## Ledger view

The employee detail drawer and the portal read-only ledger show: date, entry type, days, **running balance** (cumulative sum ordered by `effective_date, created_at`), note.

## Checklist before finishing

- [ ] Vitest table cases for each rule touched, including the interpretation cases above
- [ ] `sum(monthSplit) === workingDays` property test passes
- [ ] No ledger UPDATE or DELETE. Reversals are linked to the request.
- [ ] Server stores its own `workingDays` result, not the client's number
