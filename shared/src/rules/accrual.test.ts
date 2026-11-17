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

describe("monthlyAccrualFor (rule 6)", () => {
  const base = { rateDays: 2, prorateHireMonth: true, hireDate: "2020-01-01", endDate: null, month: "2026-11" };

  it("full rate for a full month of employment", () => {
    expect(monthlyAccrualFor(base)).toBe(2);
  });
  it("0 when hired after the month or left before it", () => {
    expect(monthlyAccrualFor({ ...base, hireDate: "2026-12-01" })).toBe(0);
    expect(monthlyAccrualFor({ ...base, endDate: "2026-10-31" })).toBe(0);
  });
  it("prorates the hire month by calendar days employed when proration is on", () => {
    // hired 16 Nov: 15 of 30 days → 2 × 0.5 = 1
    expect(monthlyAccrualFor({ ...base, hireDate: "2026-11-16" })).toBe(1);
    // hired 24 Nov: 7/30 × 2 = 0.4667 → 0.5
    expect(monthlyAccrualFor({ ...base, hireDate: "2026-11-24" })).toBe(0.5);
    // hired 29 Nov: 2/30 × 2 = 0.133 → 0
    expect(monthlyAccrualFor({ ...base, hireDate: "2026-11-29" })).toBe(0);
  });
  it("gives the full hire month when proration is off", () => {
    expect(monthlyAccrualFor({ ...base, hireDate: "2026-11-24", prorateHireMonth: false })).toBe(2);
  });
  it("always prorates a leaver's last month (nothing after end_date)", () => {
    // left 15 Nov: 15/30 × 2 = 1
    expect(monthlyAccrualFor({ ...base, endDate: "2026-11-15" })).toBe(1);
    expect(monthlyAccrualFor({ ...base, endDate: "2026-11-15", prorateHireMonth: false })).toBe(1);
  });
  it("hire and leave in the same month", () => {
    // 10 → 19 Nov: 10/30 × 1.5 = 0.5
    expect(monthlyAccrualFor({ ...base, rateDays: 1.5, hireDate: "2026-11-10", endDate: "2026-11-19" })).toBe(0.5);
  });
  it("rounds a non half-step rate (override / 12)", () => {
    expect(monthlyAccrualFor({ ...base, rateDays: 25 / 12 })).toBe(2);
    expect(monthlyAccrualFor({ ...base, rateDays: 30 / 12 })).toBe(2.5);
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

describe("accrualRate (employee override interpretation)", () => {
  it("uses the policy rate without an override", () => {
    expect(accrualRate({ accrualMode: "monthly", rateDays: 1.5, override: null })).toBe(1.5);
    expect(accrualRate({ accrualMode: "annual", rateDays: 25, override: null })).toBe(25);
  });
  it("override is the annual grant in annual mode", () => {
    expect(accrualRate({ accrualMode: "annual", rateDays: 25, override: 30 })).toBe(30);
  });
  it("override / 12 is the monthly rate in monthly mode", () => {
    expect(accrualRate({ accrualMode: "monthly", rateDays: 1.5, override: 30 })).toBe(2.5);
  });
});
