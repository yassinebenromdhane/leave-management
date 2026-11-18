// Spec 4.2 rule 6: accrual amounts (MVP: triggered by the manual "Run accrual" button).
// Pure functions: the server decides who and which policy, these decide how many days.
//
// Interpretations (not stated by the spec; covered by accrual.test.ts):
// - Proration is by CALENDAR days employed in the month (hire date and end date inclusive).
// - `prorateHireMonth` only governs the hire month. A leaver's last month is always prorated,
//   because the spec says nothing accrues after end_date.
// - Annual grants are prorated by months remaining in the leave year, the hire (or leaving)
//   month counted by days, when the employee is hired during that leave year.
// - A policy's rate is in DAYS PER LEAVE YEAR in both modes (decided with the operator,
//   Nov 2026: e.g. 22 a year earned monthly ≈ 1.83 a month). An employee's
//   `annualAllowanceOverride` replaces it.
// - Monthly mode is cumulative within the leave year (see monthlyAccrualFor), so amounts that are
//   not 0.5 steps per month (22 / 12) still total exactly 22 a year in 0.5-day ledger entries.
import { addMonths, getDaysInMonth } from "date-fns";
import type { IsoDate } from "../types";
import { addIsoDays, daysBetween, monthKey, toDate, toIso } from "./dates";

/** "YYYY-MM" */
export type MonthKey = string;

export const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Rounding of accrual to the 0.5-day unit (spec open question, settled with the operator in
// Nov 2026): round half-up to the nearest 0.5 (0.25 → 0.5, 0.74 → 0.5, 0.75 → 1), applied to the
// RUNNING TOTAL of the leave year in monthly mode, so the remainder carries to the next month and
// nothing is lost. Change it here only. Never negative.
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
  /**
   * Days per LEAVE YEAR in force for a given month of the leave year (policy version and employee
   * override already applied). Earned month by month: rate / 12 per full month.
   */
  annualRateFor: (month: MonthKey) => number;
  prorateHireMonth: boolean;
  /** First month of the leave year, 1..12 (company setting). */
  leaveYearStartMonth: number;
  month: MonthKey;
};

/**
 * Days credited for one month (rule 6), CUMULATIVE within the leave year so the 0.5-day unit
 * never loses days: credit = roundAccrual(earned up to and including this month) −
 * roundAccrual(earned before it). 22 days a year gives 2, 1.5, 2, 2, 1.5… and exactly 22.0 over
 * the year; the running total stays within ±0.25 day of the exact amount. A partial month earns
 * by calendar days employed (22 / 12 / 30 ≈ 0.06 a day in a 30-day month). The leave year's first
 * month starts from zero again (carryover is a separate ledger entry). Pure and order-free: the
 * credit for a month depends only on its inputs, so runs stay idempotent per period key.
 */
export function monthlyAccrualFor(input: MonthlyAccrualInput): number {
  const yearStart = leaveYearStartFor(`${input.month}-01`, input.leaveYearStartMonth);
  let before = 0;
  let current = 0;
  for (let i = 0; i < 12; i++) {
    const month = monthKey(toIso(addMonths(toDate(yearStart), i)));
    const earned = (input.annualRateFor(month) / 12) * employedFraction(month, input, input.prorateHireMonth);
    if (month === input.month) {
      current = earned;
      break;
    }
    before += earned;
  }
  // Integer halves on both sides, so the difference is an exact 0.5 step.
  const halves = roundAccrual(before + current) * 2 - roundAccrual(before) * 2;
  return Math.max(0, halves) / 2;
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
 * Days per leave year for one employee: the policy rate, or the employee's annual allowance
 * override. Both modes count in days per leave year (annual: granted at the start; monthly:
 * earned month by month through monthlyAccrualFor).
 */
export function accrualRate(input: { rateDays: number; override: number | null }): number {
  return input.override ?? input.rateDays;
}
