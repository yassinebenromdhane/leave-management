// Spec 4.2 rule 9: a leave spanning several months is allocated day by day (rule 1 values,
// including the half-day edges) so monthly totals always sum to the leave total.
import { monthKey } from "./dates";
import { fromHalves } from "./halfDays";
import { dayValues, type DayCountInput } from "./workingDays";

/** Map of "YYYY-MM" → days, in chronological order. Months with 0 days are omitted. */
export function monthSplit(input: DayCountInput): Map<string, number> {
  const halves = new Map<string, number>();
  for (const { date, halves: h } of dayValues(input)) {
    if (h === 0) continue;
    const k = monthKey(date);
    halves.set(k, (halves.get(k) ?? 0) + h);
  }
  return new Map([...halves].map(([k, h]) => [k, fromHalves(h)]));
}
