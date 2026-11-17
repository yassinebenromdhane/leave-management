---
name: operator-command-ui
description: Spec 2.1 to 2.4 operator workspace UI. Covers the single-screen command layout (56 px rail, top bar, KPI cards as filters, timeline/list workspace, 280 px Who's out panel, 480 px slide-over drawer routed at /leave/:id), the 10-second leave drawer with live day count, balance preview and conflict strip, timeline bars and shading, keyboard shortcuts, optimistic saves with a 6 s Undo toast, empty states and responsive breakpoints. Use when building anything under web/src/operator.
---

# Operator command UI

The operator does a full day's work **without a page navigation**. One workspace with overlays. **The calendar never closes:** every create and edit happens in a drawer over the live timeline.

## Layout (spec 2.1)

| Zone | Content | Behaviour |
| --- | --- | --- |
| Left rail, 56 px | Workspace, Employees, Reports, Settings | Icons; expands to labels on hover; four destinations, no nesting |
| Top bar | Search, department filter, period nav `< Today >`, zoom switch, `+ Log leave`, `Export` | Fixed. Export = current month payroll summary in the last-used format |
| KPI row | Out today, Pending requests, Upcoming (14 days), Low balances | One number, one label, one context line ("3 back on Monday"); **each card is a toggle filter**; no charts |
| Workspace | Timeline (default) or List, via segmented control | Takes all remaining height; scroll position kept when a drawer opens |
| Right panel, 280 px | Who's out: Today / This week / Next week | Avatar, name, type, return date; auto-collapses < 1280 px |
| Drawer, 480 px, from right | Leave form, employee detail | Overlays the right panel; the timeline stays visible and live |

Drawers are routes: `/leave/new`, `/leave/:id`, `/employees/:id`. They are bookmarkable and the back button closes them. `Esc` closes; unsaved changes prompt **once**.

## Leave drawer: two decisions, who and when (spec 1.2)

| Step | Behaviour |
| --- | --- |
| Open | `C`, `+ Log leave`, or click-drag across a row (employee and dates prefilled; drag-create is V2, but click-a-cell prefill is fine) |
| Employee | Type-ahead; the 5 most recent first; autofocus |
| Leave type | Defaults to paid leave (or last used); keys `1`–`9` switch type |
| Dates | One range picker; presets Today, Tomorrow, This week, Next week (typed `12/01 - 16/01` is V2) |
| Half days | First- and last-day toggle: Full / Morning / Afternoon (`HalfDayToggle`) |
| Days counted | Live: "4.5 working days (1 weekend, 1 public holiday excluded)" from `@leave/shared` |
| Balance preview | "Paid leave: 12 → 7.5 days", red when negative (`BalancePreview`) |
| Attachment | Drag-drop or paste; PDF / JPG / PNG ≤ 10 MB; paperclip flag when required and missing |
| Note | Optional |
| Save | `Ctrl+Enter` → default status (Approved, configurable); `Shift+Ctrl+Enter` → Pending |

`ConflictStrip` inside the drawer: blocking issues disable save, with a link to the conflicting leave. Warnings show, **saving through them needs no extra click**, and the saved leave gets a small warning marker. (The mini department timeline and the ghost bar are V2.)

For portal requests the drawer also shows the employee's note and attachment, the "from portal" marker, the conflict result stored at submit, the balance-after figure, and `A` approve / `R` reject.

## Timeline (spec 1.4), MVP scope

- Rows = employees grouped by collapsible department. Columns = days. Week and Month zoom (Month is the default; Quarter and Year are V2).
- Bars: colour = leave type; **solid = approved, hatched = pending**; half-width cell for half days; rejected and cancelled hidden by default.
- Background: weekends and holidays shaded, holiday name on hover, vertical line for today.
- Sticky employee column, sticky date header, per-department headcount row ("3 off").
- Filters: department, type, status, free-text search. Persisted per session. They **also apply to the KPI cards**.
- Click a bar → drawer. A click on an empty cell opens a new leave prefilled.
- Rows 32 px. Skeleton rows while loading. Virtualize rows above 150 employees only (spec).
- The List view is a sortable, filterable table of all leaves with multi-select for **bulk approve**.

## Status interactions

Click a status pill to change it, or `A` / `R` on the selected row. Editing an approved leave's dates triggers the server's reversal + new entry. The UI just refetches.

## Keyboard shortcuts (spec 2.2)

`C` new leave · `E` add employee · `/` focus search · `Ctrl+K` palette (V2) · `T` today · `←/→` period · `W M` zoom (`Q Y` V2) · `A/R` approve/reject · `Ctrl+Enter` save · `Esc` close or clear · `?` shortcut sheet.
Implement in one `useShortcuts` hook. **Single-letter keys are disabled while a text field, select or contenteditable has focus.** `ShortcutSheet` lists them, translated.

## Frictionless patterns

- **Optimistic saves:** the bar appears instantly; `UndoToast` for 6 s; a failure rolls back with a clear message. Undo calls the server.
- **Inline editing** in the employee table: double-click a cell (allowance, department), `Tab` to the next cell. **Quick add:** an empty last row; `Enter` saves and opens the next. Only name, department and hire date are required.
- Balance cells: remaining days as the main figure, "taken · pending" muted below, **red < 0, amber < 2**.
- Remembered defaults: last leave type, filters, zoom, export format.
- Confirmations only for destructive or locked-period actions.

## Empty states (exact copy, translated)

- No employees: "Add your first employee or import a list"
- No leaves this month: "Nobody is off. Press C to log a leave"
- No results: "No match. Clear filters"

## Responsive (spec 2.4)

- ≥ 1280: full layout.
- 768–1279: the right panel collapses to a button; the KPI row scrolls horizontally.
- < 768: the timeline becomes an **agenda list grouped by day**; KPIs in a 2×2 grid; the drawer becomes a full-height bottom sheet; bottom tab bar (Today, Calendar, Employees, More); floating `+` logs a leave; settings and reports are read-only. Touch targets ≥ 44 px; camera capture for attachments.

## Done means

The 10-second test passes: `C` → type 3 letters → Enter → pick a range → `Ctrl+Enter`, with no mouse and the timeline visible throughout.
