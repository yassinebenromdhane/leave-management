// Pure grouping helpers: the mobile agenda (by day), the "Who's out" panel, timeline row groups
// and the union fetch range.
import { addIsoDays, isoWeekday, type HalfDay } from "@leave/shared";
import type { EmployeeRow } from "@/common/api/employees";
import type { LeaveRow } from "@/common/api/leaves";
import { returnDate, UPCOMING_DAYS, type CalendarContext } from "./kpis";
import { buildColumns } from "./timelineModel";

/** Which part of `date` the leave covers: full, morning (am) or afternoon (pm). */
export function halfOnDate(l: Pick<LeaveRow, "startDate" | "endDate" | "startHalf" | "endHalf">, date: string): HalfDay {
  if (l.startDate === l.endDate) return l.startHalf;
  if (date === l.startDate) return l.startHalf === "pm" ? "pm" : "full";
  if (date === l.endDate) return l.endHalf === "am" ? "am" : "full";
  return "full";
}

export type AgendaDay = { date: string; items: Array<{ leave: LeaveRow; half: HalfDay }> };

/** Days of [from, to] with at least one leave, skipping weekends and holidays; people sorted by name. */
export function groupByDay(leaves: readonly LeaveRow[], from: string, to: string, ctx: CalendarContext): AgendaDay[] {
  const days: AgendaDay[] = [];
  for (const col of buildColumns(from, to, ctx.workDays, ctx.holidays, ctx.today)) {
    if (col.shaded) continue;
    const items = leaves
      .filter((l) => l.startDate <= col.date && l.endDate >= col.date)
      .map((leave) => ({ leave, half: halfOnDate(leave, col.date) }))
      .sort((a, b) => a.leave.employeeName.localeCompare(b.leave.employeeName));
    if (items.length) days.push({ date: col.date, items });
  }
  return days;
}

export type WhosOutTab = "today" | "week" | "next";
export const WHOS_OUT_TABS: readonly WhosOutTab[] = ["today", "week", "next"];

export function tabRange(tab: WhosOutTab, today: string): { from: string; to: string } {
  if (tab === "today") return { from: today, to: today };
  const monday = addIsoDays(today, 1 - isoWeekday(today));
  const from = tab === "week" ? monday : addIsoDays(monday, 7);
  return { from, to: addIsoDays(from, 6) };
}

export type OutLine = { leave: LeaveRow; back: string };

/** Approved leaves touching the tab's window, with the date each person is back. */
export function whosOut(leaves: readonly LeaveRow[], tab: WhosOutTab, ctx: CalendarContext): OutLine[] {
  const { from, to } = tabRange(tab, ctx.today);
  return leaves
    .filter((l) => l.status === "approved" && l.startDate <= to && l.endDate >= from)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.employeeName.localeCompare(b.employeeName))
    .map((leave) => ({ leave, back: returnDate(leave, ctx) }));
}

/** One query covers the visible period, this week, next week and the 14-day upcoming window. */
export function fetchRange(period: { from: string; to: string }, today: string): { from: string; to: string } {
  const thisMonday = tabRange("week", today).from;
  const horizon = addIsoDays(today, UPCOMING_DAYS);
  return { from: period.from < thisMonday ? period.from : thisMonday, to: period.to > horizon ? period.to : horizon };
}

export type DepartmentGroup = {
  departmentId: string;
  name: string;
  rows: Array<{ employee: EmployeeRow; leaves: LeaveRow[] }>;
};

/** Timeline rows: employees grouped by department (reference order), each with its visible leaves. */
export function buildGroups(
  employees: readonly EmployeeRow[],
  leaves: readonly LeaveRow[],
  departmentOrder: ReadonlyArray<{ id: string }>,
  opts: { requireLeaves: boolean; keepIds?: ReadonlySet<string> },
): DepartmentGroup[] {
  const byEmployee = new Map<string, LeaveRow[]>();
  for (const l of leaves) byEmployee.set(l.employeeId, [...(byEmployee.get(l.employeeId) ?? []), l]);

  const groups = new Map<string, DepartmentGroup>();
  for (const employee of employees) {
    const mine = byEmployee.get(employee.id) ?? [];
    const keep = opts.keepIds ? opts.keepIds.has(employee.id) : !opts.requireLeaves || mine.length > 0;
    if (!keep) continue;
    const g = groups.get(employee.departmentId) ?? { departmentId: employee.departmentId, name: employee.departmentName, rows: [] };
    g.rows.push({ employee, leaves: mine });
    groups.set(employee.departmentId, g);
  }
  const rank = new Map(departmentOrder.map((d, i) => [d.id, i]));
  return [...groups.values()].sort((a, b) => (rank.get(a.departmentId) ?? 999) - (rank.get(b.departmentId) ?? 999) || a.name.localeCompare(b.name));
}
