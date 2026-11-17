// Calendar-date helpers for the browser. Dates are ISO "YYYY-MM-DD" strings, never Date at midnight.
import { addIsoDays, isoWeekday } from "@leave/shared";

const pad = (n: number) => String(n).padStart(2, "0");

/** Today in the browser's local calendar. */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function monthBounds(iso: string): { from: string; to: string } {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

/** First day of the month `n` months away from the month of `iso`. */
export const addMonths = (iso: string, n: number): string => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + n;
  const date = new Date(Date.UTC(y, m, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-01`;
};

export type PresetKey = "today" | "tomorrow" | "thisWeek" | "nextWeek";
export const PRESET_KEYS: readonly PresetKey[] = ["today", "tomorrow", "thisWeek", "nextWeek"];

/** Presets of the leave drawer. "This week" runs to Sunday; non-working days are excluded by the count. */
export function datePreset(key: PresetKey, today: string): { start: string; end: string } {
  const toSunday = (d: string) => addIsoDays(d, 7 - isoWeekday(d));
  switch (key) {
    case "today":
      return { start: today, end: today };
    case "tomorrow": {
      const d = addIsoDays(today, 1);
      return { start: d, end: d };
    }
    case "thisWeek":
      return { start: today, end: toSunday(today) };
    case "nextWeek": {
      const monday = addIsoDays(toSunday(today), 1);
      return { start: monday, end: addIsoDays(monday, 6) };
    }
  }
}
