import { describe, expect, it } from "vitest";
import {
  accrualRate,
  annualGrantFor,
  isFuturePeriod,
  leaveYearLabel,
  leaveYearStartFor,
  monthBounds,
  monthlyAccrualFor,
  roundAccrual,
} from "./accrual";
import { sumDays } from "./halfDays";

describe("roundAccrual (OPEN QUESTION: round half-up to the nearest 0.5)", () => {
  it.each([
    [0, 0],
    [0.2, 0],
    [0.24, 0],
    [0.25, 0.5],
    [0.5, 0.5],
    [0.74, 0.5],
    [0.75, 1],
    [1.5, 1.5],
    [2.0833, 2],
    [2.25, 2.5],
    [12.4999, 12.5],
    [-0.2, 0],
  ])("%s → %s", (input, expected) => {
    expect(roundAccrual(input)).toBe(expected);
  });

  it("absorbs floating-point noise at the .25 boundary", () => {
    // 1.5 × 5/30 = 0.25 but computes as 0.24999999999999997 in floating point
    expect(roundAccrual((1.5 * 5) / 30)).toBe(0.5);
  });
});

describe("monthBounds / isFuturePeriod", () => {
  it("returns the first and last day of the month", () => {
    expect(monthBounds("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29", days: 29 });
    expect(monthBounds("2026-11")).toEqual({ start: "2026-11-01", end: "2026-11-30", days: 30 });
  });
  it("only months after today's month are future", () => {
    expect(isFuturePeriod("2026-11", "2026-11-16")).toBe(false);
    expect(isFuturePeriod("2026-10", "2026-11-16")).toBe(false);
    expect(isFuturePeriod("2026-12", "2026-11-16")).toBe(true);
  });
});

describe("leave year", () => {
  it("start date for a date and a start month", () => {
    expect(leaveYearStartFor("2026-11-16", 1)).toBe("2026-01-01");
    expect(leaveYearStartFor("2026-11-16", 6)).toBe("2026-06-01");
    expect(leaveYearStartFor("2026-03-10", 6)).toBe("2025-06-01");
    expect(leaveYearStartFor("2026-06-01", 6)).toBe("2026-06-01");
  });
  it("label is Y + year, or Y + two years when the leave year does not start in January", () => {
    expect(leaveYearLabel("2026-01-01")).toBe("Y2026");
    expect(leaveYearLabel("2026-06-01")).toBe("Y2026-27");
    expect(leaveYearLabel("2099-09-01")).toBe("Y2099-00");
  });
});

describe("monthlyAccrualFor (rule 6, cumulative: N days per leave year earned month by month)", () => {
  // Credit for a month = round(earned so far, this month included) − round(earned before it).
  const base = {
    annualRateFor: (_month: string): number => 22,
    prorateHireMonth: true,
    hireDate: "2020-01-01",
    endDate: null,
    leaveYearStartMonth: 1,
  };
  const months = (year: number, startMonth = 1) =>
    Array.from({ length: 12 }, (_, i) => {
      const m = ((startMonth - 1 + i) % 12) + 1;
      const y = year + Math.floor((startMonth - 1 + i) / 12);
      return `${y}-${String(m).padStart(2, "0")}`;
    });
  const yearOf = (input: Partial<typeof base> = {}, year = 2026, startMonth = 1) =>
    months(year, startMonth).map((month) => monthlyAccrualFor({ ...base, leaveYearStartMonth: startMonth, ...input, month }));

  it("22 days a year: months alternate 2 / 1.5 and the year totals exactly 22", () => {
    const credits = yearOf();
    expect(credits).toEqual([2, 1.5, 2, 2, 1.5, 2, 2, 1.5, 2, 2, 1.5, 2]);
    expect(sumDays(credits)).toBe(22);
    for (const c of credits) expect(Number.isInteger(c * 2)).toBe(true); // 0.5 steps only
  });

  it.each([18, 22, 24, 25, 26, 30, 0])("%s days a year: a full year totals exactly that, in 0.5 steps", (rate) => {
    const credits = yearOf({ annualRateFor: () => rate });
    expect(sumDays(credits)).toBe(rate);
    expect(credits.every((c) => c >= 0 && Number.isInteger(c * 2))).toBe(true);
  });

  it("the running balance never drifts more than a quarter day from the exact 22/12 per month", () => {
    let total = 0;
    yearOf().forEach((c, i) => {
      total += c;
      expect(Math.abs(total - (22 * (i + 1)) / 12)).toBeLessThanOrEqual(0.25 + 1e-9);
    });
  });

  it("joined mid-month: earns ~0.06 per day worked (22/12/30), the rounding remainder carries over", () => {
    // Hired 16 Nov: 15/30 × 1.8333 = 0.9167 earned → 1.0 credited (half-up);
    // Dec: 0.9167 + 1.8333 = 2.75 earned → 3.0 total → 2.0 credited.
    expect(monthlyAccrualFor({ ...base, hireDate: "2026-11-16", month: "2026-11" })).toBe(1);
    expect(monthlyAccrualFor({ ...base, hireDate: "2026-11-16", month: "2026-12" })).toBe(2);
    // Hired 29 Nov: 2 days × 0.0611 = 0.12 → 0 now, but it is not lost: Dec gets 2.0 (1.96 → 2).
    expect(monthlyAccrualFor({ ...base, hireDate: "2026-11-29", month: "2026-11" })).toBe(0);
    expect(monthlyAccrualFor({ ...base, hireDate: "2026-11-29", month: "2026-12" })).toBe(2);
  });

  it("hired mid-year: the year totals the prorated amount (by calendar days in the hire month)", () => {
    // Hired 1 Jul: 6 months × 22/12 = 11
    expect(sumDays(yearOf({ hireDate: "2026-07-01" }))).toBe(11);
  });

  it("gives the full hire month when proration is off", () => {
    expect(monthlyAccrualFor({ ...base, hireDate: "2026-11-24", prorateHireMonth: false, month: "2026-11" })).toBe(2);
  });

  it("0 when hired after the month or left before it", () => {
    expect(monthlyAccrualFor({ ...base, hireDate: "2026-12-01", month: "2026-11" })).toBe(0);
    expect(monthlyAccrualFor({ ...base, endDate: "2026-10-31", month: "2026-11" })).toBe(0);
  });

  it("always prorates a leaver's last month (nothing after end_date)", () => {
    // Left 15 Jan: 15/31 × 1.8333 = 0.887 → 1.0
    expect(monthlyAccrualFor({ ...base, endDate: "2026-01-15", month: "2026-01" })).toBe(1);
    expect(monthlyAccrualFor({ ...base, endDate: "2026-01-15", month: "2026-02" })).toBe(0);
  });

  it("restarts at each leave-year start (carryover is a separate entry)", () => {
    expect(monthlyAccrualFor({ ...base, month: "2027-01" })).toBe(2); // same as any January
  });

  it("works for a leave year that does not start in January", () => {
    const credits = yearOf({}, 2026, 6); // Jun 2026 – May 2027
    expect(credits[0]).toBe(2);
    expect(sumDays(credits)).toBe(22);
  });

  it("a rate change mid-year applies from its month and keeps the running total consistent", () => {
    // 18 a year until June, 24 from July: 6 × 1.5 + 6 × 2 = 21 over the year.
    const annualRateFor = (m: string) => (m < "2026-07" ? 18 : 24);
    expect(sumDays(yearOf({ annualRateFor }))).toBe(21);
  });

  it("is idempotent and order-free: each month's credit depends only on its inputs", () => {
    const forward = yearOf();
    const backward = months(2026)
      .reverse()
      .map((month) => monthlyAccrualFor({ ...base, month }))
      .reverse();
    expect(backward).toEqual(forward);
  });
});

describe("annualGrantFor", () => {
  const base = { rateDays: 24, prorateHireMonth: true, hireDate: "2020-01-01", endDate: null, leaveYearStart: "2026-01-01" };

  it("full grant when employed for the whole leave year", () => {
    expect(annualGrantFor(base)).toBe(24);
  });
  it("0 when not employed in that leave year", () => {
    expect(annualGrantFor({ ...base, hireDate: "2027-01-01" })).toBe(0);
    expect(annualGrantFor({ ...base, endDate: "2025-12-31" })).toBe(0);
  });
  it("prorates by months remaining, the hire month by days", () => {
    // hired 1 Jul: 6 of 12 months → 12
    expect(annualGrantFor({ ...base, hireDate: "2026-07-01" })).toBe(12);
    // hired 16 Nov: 15/30 of Nov + Dec = 1.5 months → 24 × 1.5/12 = 3
    expect(annualGrantFor({ ...base, hireDate: "2026-11-16" })).toBe(3);
  });
  it("full grant for a mid-year hire when proration is off", () => {
    expect(annualGrantFor({ ...base, hireDate: "2026-07-01", prorateHireMonth: false })).toBe(24);
  });
  it("prorates a known end date inside the leave year", () => {
    // employed Jan–Mar: 3/12 × 24 = 6
    expect(annualGrantFor({ ...base, endDate: "2026-03-31" })).toBe(6);
  });
  it("works for a leave year that does not start in January", () => {
    // year Jun 2026 – May 2027, hired 1 Dec 2026: 6 months → 12
    expect(annualGrantFor({ ...base, leaveYearStart: "2026-06-01", hireDate: "2026-12-01" })).toBe(12);
  });
});

describe("accrualRate (days per leave year, both modes)", () => {
  it("uses the policy rate without an override", () => {
    expect(accrualRate({ rateDays: 22, override: null })).toBe(22);
  });
  it("the employee's annual allowance override replaces it, in both modes", () => {
    expect(accrualRate({ rateDays: 22, override: 25 })).toBe(25);
    expect(accrualRate({ rateDays: 22, override: 0 })).toBe(0);
  });
});
