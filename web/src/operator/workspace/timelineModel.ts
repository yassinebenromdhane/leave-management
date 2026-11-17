// Pure timeline model (spec 1.4): period range, day columns with weekend / holiday shading, and
// bar geometry. No React here so every rule is unit-tested.
import { addIsoDays, daysBetween, isoWeekday, isWorkWeekday, type HalfDay } from "@leave/shared";
import { addMonths, monthBounds } from "@/common/lib/date";

export type Zoom = "week" | "month";
export type HolidayRef = { date: string; name: string; isHalfDay: boolean };

export function periodRange(anchor: string, zoom: Zoom): { from: string; to: string } {
  if (zoom === "month") return monthBounds(anchor);
  const from = addIsoDays(anchor, 1 - isoWeekday(anchor));
  return { from, to: addIsoDays(from, 6) };
}

export function shiftAnchor(anchor: string, zoom: Zoom, dir: 1 | -1): string {
  return zoom === "month" ? addMonths(anchor, dir) : addIsoDays(anchor, 7 * dir);
}

export type DayColumn = {
  date: string;
  weekday: number; // 1 = Monday ... 7 = Sunday
  isWorkDay: boolean;
  isToday: boolean;
  holiday: string | null;
  /** Weekend (outside the company work pattern) or public holiday: background shading. */
  shaded: boolean;
};

export function buildColumns(from: string, to: string, workDays: number, holidays: readonly HolidayRef[], today: string): DayColumn[] {
  const names = new Map(holidays.map((h) => [h.date, h.name]));
  const count = Math.max(0, daysBetween(from, to) + 1);
  return Array.from({ length: count }, (_, i) => {
    const date = addIsoDays(from, i);
    const weekday = isoWeekday(date);
    const isWorkDay = isWorkWeekday(workDays, weekday);
    const holiday = names.get(date) ?? null;
    return { date, weekday, isWorkDay, isToday: date === today, holiday, shaded: !isWorkDay || holiday !== null };
  });
}

export type BarSpan = {
  startDate: string;
  endDate: string;
  startHalf: HalfDay;
  endHalf: HalfDay;
};

export type BarGeometry = {
  /** Left edge, in column units from the first column (0.5 = middle of a cell). */
  left: number;
  /** Width in column units. */
  width: number;
  clippedStart: boolean;
  clippedEnd: boolean;
};

/**
 * Where a leave sits in the visible period. A single-day "am" is the left half of its cell, "pm"
 * the right half; a multi-day leave starting "pm" begins mid-cell and ending "am" stops mid-cell.
 * Null when the leave does not touch the period.
 */
export function barGeometry(span: BarSpan, from: string, to: string): BarGeometry | null {
  if (span.endDate < from || span.startDate > to) return null;
  const columns = daysBetween(from, to) + 1;
  const clippedStart = span.startDate < from;
  const clippedEnd = span.endDate > to;
  const left = clippedStart ? 0 : daysBetween(from, span.startDate) + (span.startHalf === "pm" ? 0.5 : 0);
  const right = clippedEnd ? columns : daysBetween(from, span.endDate) + 1 - (span.endHalf === "am" ? 0.5 : 0);
  return { left, width: Math.max(0.5, right - left), clippedStart, clippedEnd };
}

/** Number of employees with a visible leave on `date` (the "3 off" headcount row). */
export function offCount(date: string, leaves: ReadonlyArray<Pick<BarSpan, "startDate" | "endDate"> & { employeeId: string }>): number {
  const ids = new Set<string>();
  for (const l of leaves) if (l.startDate <= date && l.endDate >= date) ids.add(l.employeeId);
  return ids.size;
}

/** Weekday initial for the header ("M", "T"...), from a locale. */
export function weekdayInitial(date: string, locale: string): string {
  const intl = locale.startsWith("en") ? "en-GB" : locale;
  return new Intl.DateTimeFormat(intl, { weekday: "narrow", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}
