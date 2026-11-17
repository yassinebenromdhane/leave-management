// Spec 1.6 payroll exports with spec 4.2 rule 9: a leave is allocated to a reporting period day by
// day with rule 1's per-day values (dayValues, the same basis as monthSplit), including the
// half-day edges on the leave's real first and last day. For a whole month the result equals
// monthSplit()'s value for that month, so per-month totals always sum to the leave total.
import type { IsoDate } from "../types";
import { daysBetween } from "./dates";
import { fromHalves } from "./halfDays";
import { dayValues, type DayCountInput } from "./workingDays";

export type Period = { from: IsoDate; to: IsoDate };

/** Maximum reporting span (one leap year). */
export const MAX_REPORT_SPAN_DAYS = 366;

/** Number of calendar days in the period, both ends included. */
export const periodSpanDays = (p: Period): number => daysBetween(p.from, p.to) + 1;

/** Days of the leave that fall inside [from, to]. */
export function daysInPeriod(leave: DayCountInput, period: Period): number {
  if (leave.endDate < period.from || leave.startDate > period.to) return 0;
  let halves = 0;
  for (const { date, halves: h } of dayValues(leave)) {
    if (date >= period.from && date <= period.to) halves += h;
  }
  return fromHalves(halves);
}
