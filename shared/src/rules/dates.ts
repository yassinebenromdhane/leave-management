// Calendar-date helpers on ISO "YYYY-MM-DD" strings. All arithmetic is on whole days, so the
// result is the same in any time zone (browser) and in UTC (server).
import { addDays, differenceInCalendarDays, formatISO, getISODay, parseISO } from "date-fns";
import type { IsoDate } from "../types";
import type { IsoWeekday } from "../weekMask";

export const ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const toDate = (d: IsoDate): Date => parseISO(d);
export const toIso = (d: Date): IsoDate => formatISO(d, { representation: "date" });
export const addIsoDays = (d: IsoDate, n: number): IsoDate => toIso(addDays(toDate(d), n));
export const isoWeekday = (d: IsoDate): IsoWeekday => getISODay(toDate(d)) as IsoWeekday;
export const daysBetween = (from: IsoDate, to: IsoDate): number => differenceInCalendarDays(toDate(to), toDate(from));
export const monthKey = (d: IsoDate): string => d.slice(0, 7);

/** Every date from start to end inclusive. Empty when end < start. */
export function eachIsoDate(start: IsoDate, end: IsoDate): IsoDate[] {
  const n = daysBetween(start, end);
  const out: IsoDate[] = [];
  for (let i = 0; i <= n; i++) out.push(addIsoDays(start, i));
  return out;
}

/** True when the string is a real calendar date (rejects 2026-02-30). */
export function isValidIsoDate(d: string): boolean {
  if (!ISO_DATE_RE.test(d)) return false;
  const parsed = toDate(d);
  if (Number.isNaN(parsed.getTime())) return false; // parseISO gives Invalid Date for 2024-02-30
  return toIso(parsed) === d;
}
