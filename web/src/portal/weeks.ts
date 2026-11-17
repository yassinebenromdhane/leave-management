import { addIsoDays, isoWeekday } from "@leave/shared";

/** The Team view window: this week and next, Monday to Sunday (14 days, under the 31-day server cap). */
export function twoWeeks(today: string): { from: string; to: string } {
  const from = addIsoDays(today, -(isoWeekday(today) - 1));
  return { from, to: addIsoDays(from, 13) };
}
