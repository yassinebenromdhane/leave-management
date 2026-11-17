// Spec 4.2 rule 6: accrual amounts (MVP: triggered by the manual "Run accrual" button).
// Pure functions: the server decides who and which policy, these decide how many days.
//
// Interpretations (not stated by the spec; covered by accrual.test.ts):
// - Proration is by CALENDAR days employed in the month (hire date and end date inclusive).
// - `prorateHireMonth` only governs the hire month. A leaver's last month is always prorated,
//   because the spec says nothing accrues after end_date.
// - Annual grants are prorated by months remaining in the leave year, the hire (or leaving)
//   month counted by days, when the employee is hired during that leave year.
// - An employee's `annualAllowanceOverride` replaces the yearly amount: in annual mode it IS the
//   grant; in monthly mode the monthly rate is override / 12, rounded through roundAccrual().
import { addMonths, getDaysInMonth } from "date-fns";
import type { AccrualMode, IsoDate } from "../types";
import { addIsoDays, daysBetween, monthKey, toDate, toIso } from "./dates";

/** "YYYY-MM" */
export type MonthKey = string;

export const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// OPEN QUESTION (spec): rounding of prorated accrual.
// The spec does not say how prorated amounts reach the 0.5-day unit. Choice: round half-up to the
// nearest 0.5 (0.25 → 0.5, 0.74 → 0.5, 0.75 → 1). Change it here only. Never negative.
const EPSILON = 1e-9; // absorbs floating-point noise such as 0.24999999999999997
export function roundAccrual(days: number): number {
  const halves = Math.floor(days * 2 + 0.5 + EPSILON);
  return Math.max(0, halves) / 2;
}

export function monthBounds(month: MonthKey): { start: IsoDate; end: IsoDate; days: number } {
  const start = `${month}-01`;
  const days = getDaysInMonth(toDate(start));
  return { start, end: `${month}-${String(days).padStart(2, "0")}`, days };
}

/** True when `month` is after the month containing `today` (no accrual in advance). */
export const isFuturePeriod = (month: MonthKey, today: IsoDate): boolean => month > monthKey(today);

/** First day of the leave year that contains `date`. `startMonth` is 1..12. */
export function leaveYearStartFor(date: IsoDate, startMonth: number): IsoDate {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const y = month >= startMonth ? year : year - 1;
  return `${y}-${String(startMonth).padStart(2, "0")}-01`;
}

/** Last day of the leave year that starts on `leaveYearStart`. */
export const leaveYearEnd = (leaveYearStart: IsoDate): IsoDate =>
  addIsoDays(toIso(addMonths(toDate(leaveYearStart), 12)), -1);

/** Ledger period key for a leave year: "Y2026", or "Y2026-27" when it does not start in January. */
export function leaveYearLabel(leaveYearStart: IsoDate): string {
  const year = Number(leaveYearStart.slice(0, 4));
  if (leaveYearStart.slice(5, 7) === "01") return `Y${year}`;
  return `Y${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}

type Employment = { hireDate: IsoDate; endDate: IsoDate | null };

/** Fraction (0..1) of `month` during which the employee is employed, for accrual purposes. */
function employedFraction(month: MonthKey, emp: Employment, prorateHireMonth: boolean): number {
  const { start, end, days } = monthBounds(month);
  if (emp.hireDate > end) return 0;
  if (emp.endDate !== null && emp.endDate < start) return 0;
  const from = prorateHireMonth && emp.hireDate > start ? emp.hireDate : start;
  const to = emp.endDate !== null && emp.endDate < end ? emp.endDate : end;
  return (daysBetween(from, to) + 1) / days;
}

export type MonthlyAccrualInput = Employment & {
  rateDays: number;
  prorateHireMonth: boolean;
  month: MonthKey;
};

/** Days accrued for one month (rule 6), rounded through roundAccrual(). */
export function monthlyAccrualFor(input: MonthlyAccrualInput): number {
  return roundAccrual(input.rateDays * employedFraction(input.month, input, input.prorateHireMonth));
}

export type AnnualGrantInput = Employment & {
  rateDays: number;
  prorateHireMonth: boolean;
  leaveYearStart: IsoDate;
};

/** Days granted at the start of a leave year (annual policies), rounded through roundAccrual(). */
export function annualGrantFor(input: AnnualGrantInput): number {
  if (input.hireDate > leaveYearEnd(input.leaveYearStart)) return 0;
  // Without proration a mid-year hire is treated as employed from the leave-year start.
  const emp: Employment = {
    hireDate: input.prorateHireMonth || input.hireDate < input.leaveYearStart ? input.hireDate : input.leaveYearStart,
    endDate: input.endDate,
  };
  let months = 0;
  for (let i = 0; i < 12; i++) {
    const month = monthKey(toIso(addMonths(toDate(input.leaveYearStart), i)));
    months += employedFraction(month, emp, true);
  }
  return roundAccrual((input.rateDays * months) / 12);
}

/**
 * The rate to feed monthlyAccrualFor / annualGrantFor for one employee: the policy rate, or the
 * employee's annual allowance override (annual mode: the grant; monthly mode: override / 12).
 */
export function accrualRate(input: { accrualMode: AccrualMode; rateDays: number; override: number | null }): number {
  if (input.override === null) return input.rateDays;
  return input.accrualMode === "annual" ? input.override : input.override / 12;
}
