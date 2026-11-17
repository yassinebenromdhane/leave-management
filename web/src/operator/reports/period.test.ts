import { describe, expect, it } from "vitest";
import { initialPeriod, periodRange } from "./period";

describe("report period picker", () => {
  it("defaults to the current month", () => {
    const p = initialPeriod("2026-11-16");
    expect(p.kind).toBe("month");
    expect(periodRange(p)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  });

  it("month handles February in a leap year", () => {
    expect(periodRange({ ...initialPeriod("2026-11-16"), year: 2028, month: 2 })).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("quarter spans three months", () => {
    const base = { ...initialPeriod("2026-11-16"), kind: "quarter" as const };
    expect(periodRange({ ...base, quarter: 1 })).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(periodRange({ ...base, quarter: 4 })).toEqual({ from: "2026-10-01", to: "2026-12-31" });
  });

  it("year and custom", () => {
    const base = initialPeriod("2026-11-16");
    expect(periodRange({ ...base, kind: "year" })).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(periodRange({ ...base, kind: "custom", from: "2026-03-05", to: "2026-04-10" })).toEqual({ from: "2026-03-05", to: "2026-04-10" });
  });
});
