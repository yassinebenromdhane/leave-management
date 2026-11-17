---
paths:
  - "shared/**"
---

# shared/: pure domain rules and schemas

`shared/` is the single home of the business rules and validation schemas. Both `server/` and `web/` import it. If a rule exists anywhere else, that is a bug.

## Allowed and forbidden

- **Allowed imports:** `zod`, `date-fns`, and relative imports inside `shared/`. Nothing else.
- **Forbidden:** Hono, React, Drizzle, `pg`, Better Auth, Node built-ins (`node:*`, `fs`, `path`), `process.env`, `Date.now()` / `new Date()` without an injected "today", network, randomness. The guard hook blocks these imports.
- Every function is **pure and deterministic**: same inputs, same output. Pass "today", holidays, the work pattern and the ledger in as arguments.

## Layout

```text
shared/src/
├── schemas/      # Zod: leaveRequest, employee, settings, leaveType, holiday, ledgerEntry, portal …
├── rules/
│   ├── workingDays.ts   # spec 4.2 rule 1, the only implementation
│   ├── balance.ts       # rules 2-3: balance at date, reserved, available
│   ├── monthSplit.ts    # rule 9: payroll allocation per month
│   ├── conflicts.ts     # pure parts of spec 1.3 (overlap, zero days, employment period, negative)
│   └── halfDays.ts      # half-unit arithmetic helpers
├── types.ts      # LeaveStatus, EntryType, HalfDay, Source, DayCountMode, event names
└── index.ts      # public barrel; export only what consumers need
```

## Types and units

- Dates cross every boundary as ISO calendar strings `YYYY-MM-DD` (`type IsoDate = string` with a Zod `.regex` / `.date()` check). Never use a JS `Date` at local midnight. Use date-fns `parseISO` / `formatISO(…, { representation: 'date' })` and do date arithmetic on whole days.
- Days are multiples of 0.5. Compute internally in **integer half-units** (`halves = days * 2`) and convert at the edge. Every exported day value must satisfy `Number.isInteger(x * 2)`.
- Work pattern = 7-bit mask, bit 0 = Monday … bit 6 = Sunday (matches `company_settings.work_days`). Document the bit order in `types.ts` and use it in one place.
- Enumerations are `as const` arrays plus `z.enum(...)`, so the server Drizzle enums and the UI pickers reuse the same list.

## Zod schemas

- One schema per API payload. The same schema validates the React form, the `@hono/zod-validator` input and the typed client.
- Portal schemas (`portal/*`) **must not contain `employeeId`**. The server takes it from the session.
- Blocking validations from the spec (end ≥ start, valid half-day combination) go in `.superRefine` so both sides reject the same input with the same i18n message key, e.g. `errors.endBeforeStart`.
- Error messages are **i18n keys**, never English sentences.

## Tests first (Vitest)

- Every file in `rules/` has a sibling `*.test.ts`. Write or extend the test before changing the rule.
- Use table-driven `it.each` cases with readable names, e.g. `"Mon–Fri with Wed holiday, pm start → 3.5"`.
- Must-cover edges: single-day am / pm / full, weekend-only range (0 → blocking), half-day holiday at either end, calendar-mode type across a weekend, leave spanning month and year boundaries, leap day, Sun–Thu work week, ranges entirely outside employment.
- Property check: for any leave, `sum(monthSplit(leave)) === workingDays(leave)`.
- Tests run with `TZ=UTC`. No snapshot tests for numbers.

Load the `ledger-and-calculation-engine` skill before touching `rules/`.
