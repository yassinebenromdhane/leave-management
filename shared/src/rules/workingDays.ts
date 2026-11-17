// Spec 4.2 rule 1: working days. The ONLY implementation; the browser uses it for the live
// "4.5 working days (1 weekend, 1 public holiday excluded)" line, the server for the stored value.
//
// Per date (start to end inclusive):
//   calendar mode -> 1
//   working mode  -> 0 if the weekday is not in the work pattern, 0 on a full holiday,
//                    0.5 on a half-day holiday, otherwise 1
// Then: -0.5 on the first day if it is afternoon-only, -0.5 on the last day if morning-only.
//
// Interpretations (not stated by the spec; covered by tests):
// - Single-day leave: start === end and startHalf === endHalf. "am"/"pm" is half a day, capped
//   by what the day is worth (a half-day holiday taken as a morning still counts 0.5).
// - Multi-day leave: first day is "full" or "pm", last day is "full" or "am" (no gaps).
// - A single day never counts below 0 (a "pm" start on a half-day holiday counts 0).
// - The half-day adjustment also applies in calendar mode.
import type { DayCountMode, HalfDay, IsoDate } from "../types";
import { isWorkWeekday, type WeekMask } from "../weekMask";
import { eachIsoDate, isoWeekday } from "./dates";
import { fromHalves, type Halves } from "./halfDays";

export type HolidayDay = { date: IsoDate; isHalfDay: boolean };

export type LeaveSpan = {
  startDate: IsoDate;
  endDate: IsoDate;
  startHalf: HalfDay;
  endHalf: HalfDay;
};

export type DayCountInput = LeaveSpan & {
  mode: DayCountMode;
  workDays: WeekMask; // employee override ?? company pattern
  holidays: readonly HolidayDay[];
};

export type DayCountResult = {
  /** Counted days, a multiple of 0.5. */
  days: number;
  /** Dates skipped because they are outside the work pattern (working mode only). */
  weekendDays: number;
  /** Work-pattern dates reduced by a public holiday (full or half), working mode only. */
  holidayDays: number;
};

export type DayValue = { date: IsoDate; halves: Halves };

/** True when the half-day combination is possible (see interpretations above). */
export function isValidHalfCombination(span: Pick<LeaveSpan, "startDate" | "endDate" | "startHalf" | "endHalf">): boolean {
  if (span.endDate < span.startDate) return false;
  if (span.startDate === span.endDate) return span.startHalf === span.endHalf;
  return span.startHalf !== "am" && span.endHalf !== "pm";
}

/** Value of each date of the leave, in halves, after the half-day edge rules. */
export function dayValues(input: DayCountInput): DayValue[] {
  const holidays = new Map(input.holidays.map((h) => [h.date, h.isHalfDay]));
  const dates = eachIsoDate(input.startDate, input.endDate);
  const single = dates.length === 1;

  return dates.map((date, i) => {
    let halves: Halves;
    if (input.mode === "calendar") {
      halves = 2;
    } else if (!isWorkWeekday(input.workDays, isoWeekday(date))) {
      halves = 0;
    } else {
      const half = holidays.get(date);
      halves = half === undefined ? 2 : half ? 1 : 0;
    }

    if (single) {
      if (input.startHalf !== "full") halves = Math.min(halves, 1);
    } else {
      if (i === 0 && input.startHalf === "pm") halves = Math.max(halves - 1, 0);
      if (i === dates.length - 1 && input.endHalf === "am") halves = Math.max(halves - 1, 0);
    }
    return { date, halves };
  });
}

export function workingDays(input: DayCountInput): DayCountResult {
  if (!isValidHalfCombination(input)) {
    throw new Error("Invalid leave span: check dates and half-day combination");
  }
  let total = 0;
  let weekendDays = 0;
  let holidayDays = 0;
  const holidays = new Map(input.holidays.map((h) => [h.date, h.isHalfDay]));
  for (const { date, halves } of dayValues(input)) {
    total += halves;
    if (input.mode === "working") {
      if (!isWorkWeekday(input.workDays, isoWeekday(date))) weekendDays += 1;
      else if (holidays.has(date)) holidayDays += 1;
    }
  }
  return { days: fromHalves(total), weekendDays, holidayDays };
}
