// KPI numbers and the KPI filter predicate (spec 2.1 / 2.3). Pure functions over already-scoped
// leaves and employees; the caller applies department / type / search first.
import { addIsoDays, daysBetween, isoWeekday, isWorkWeekday } from "@leave/shared";
import type { EmployeeRow } from "@/common/api/employees";
import type { LeaveRow } from "@/common/api/leaves";
import type { KpiKey } from "./filters";
import type { HolidayRef } from "./timelineModel";

export const LOW_BALANCE_THRESHOLD = 2;
export const UPCOMING_DAYS = 14;

export type CalendarContext = { today: string; workDays: number; holidays: readonly HolidayRef[] };

const counts = (l: Pick<LeaveRow, "status">) => l.status === "approved" || l.status === "pending";

export const isOutOn = (l: Pick<LeaveRow, "status" | "startDate" | "endDate">, date: string): boolean =>
  l.status === "approved" && l.startDate <= date && l.endDate >= date;

/** Starts after today and within the next 14 days; approved or pending. */
export const isUpcoming = (l: Pick<LeaveRow, "status" | "startDate">, today: string): boolean =>
  counts(l) && l.startDate > today && l.startDate <= addIsoDays(today, UPCOMING_DAYS);

/** First working day after `date` (not a weekend, not a full-day holiday). */
export function nextWorkingDate(date: string, ctx: Pick<CalendarContext, "workDays" | "holidays">): string {
  const fullHolidays = new Set(ctx.holidays.filter((h) => !h.isHalfDay).map((h) => h.date));
  let d = addIsoDays(date, 1);
  for (let i = 0; i < 366; i++) {
    if (isWorkWeekday(ctx.workDays, isoWeekday(d)) && !fullHolidays.has(d)) return d;
    d = addIsoDays(d, 1);
  }
  return d;
}

/** Day the employee is back: the next working day, or the end date itself after a morning-only last day. */
export function returnDate(l: Pick<LeaveRow, "endDate" | "endHalf">, ctx: Pick<CalendarContext, "workDays" | "holidays">): string {
  return l.endHalf === "am" ? l.endDate : nextWorkingDate(l.endDate, ctx);
}

/** Employees with any deducting-type balance below 2 days (restricted to one type when given). */
export function lowBalanceEmployees(
  employees: readonly EmployeeRow[],
  leaveTypeId: string | null,
): Array<{ employee: EmployeeRow; lowest: number }> {
  const out: Array<{ employee: EmployeeRow; lowest: number }> = [];
  for (const employee of employees) {
    if (employee.status !== "active") continue;
    const values = Object.entries(employee.balances)
      .filter(([typeId]) => !leaveTypeId || typeId === leaveTypeId)
      .map(([, b]) => b.available);
    if (values.length === 0) continue;
    const lowest = Math.min(...values);
    if (lowest < LOW_BALANCE_THRESHOLD) out.push({ employee, lowest });
  }
  return out;
}

export type Kpis = {
  out: { count: number; backCount: number; backDate: string | null };
  pending: { count: number; oldestDays: number | null };
  upcoming: { count: number; next: { employeeName: string; date: string } | null };
  low: { count: number; lowest: { employeeName: string; available: number } | null };
};

export function computeKpis(input: {
  leaves: readonly LeaveRow[];
  employees: readonly EmployeeRow[];
  leaveTypeId: string | null;
  ctx: CalendarContext;
}): Kpis {
  const { leaves, employees, ctx, leaveTypeId } = input;
  const { today } = ctx;

  const outNow = leaves.filter((l) => isOutOn(l, today));
  const outPeople = new Map(outNow.map((l) => [l.employeeId, l]));
  const backDates = [...outPeople.values()].map((l) => returnDate(l, ctx));
  const backDate = backDates.length ? backDates.reduce((a, b) => (a < b ? a : b)) : null;

  const pending = leaves.filter((l) => l.status === "pending");
  const oldest = pending.reduce<string | null>((acc, l) => {
    const created = (l.submittedAt ?? l.createdAt).slice(0, 10);
    return acc === null || created < acc ? created : acc;
  }, null);

  const upcoming = leaves.filter((l) => isUpcoming(l, today)).sort((a, b) => a.startDate.localeCompare(b.startDate));

  const low = lowBalanceEmployees(employees, leaveTypeId).sort((a, b) => a.lowest - b.lowest);

  return {
    out: { count: outPeople.size, backCount: backDate ? backDates.filter((d) => d === backDate).length : 0, backDate },
    pending: { count: pending.length, oldestDays: oldest === null ? null : Math.max(0, daysBetween(oldest, today)) },
    upcoming: { count: upcoming.length, next: upcoming[0] ? { employeeName: upcoming[0].employeeName, date: upcoming[0].startDate } : null },
    low: { count: low.length, lowest: low[0] ? { employeeName: low[0].employee.fullName, available: low[0].lowest } : null },
  };
}

/** Whether a leave belongs to the active KPI filter. `lowIds` = ids of employees with a low balance. */
export function leaveMatchesKpi(l: LeaveRow, kpi: KpiKey, today: string, lowIds: ReadonlySet<string>): boolean {
  switch (kpi) {
    case "out":
      return isOutOn(l, today);
    case "pending":
      return l.status === "pending";
    case "upcoming":
      return isUpcoming(l, today);
    case "low":
      return lowIds.has(l.employeeId);
  }
}

export const firstName = (fullName: string): string => fullName.trim().split(/\s+/)[0] ?? fullName;
