import { describe, expect, it } from "vitest";
import { WEEK_PRESETS } from "../weekMask";
import { monthSplit } from "./monthSplit";
import { daysInPeriod, periodSpanDays } from "./payroll";
import { workingDays, type DayCountInput } from "./workingDays";

const leave = (over: Partial<DayCountInput> = {}): DayCountInput => ({
  startDate: "2026-01-28",
  endDate: "2026-02-03",
  startHalf: "full",
  endHalf: "full",
  mode: "working",
  workDays: WEEK_PRESETS.monFri,
  holidays: [],
  ...over,
});

describe("daysInPeriod (rule 9 applied to any period)", () => {
  it.each([
    ["January month of a Wed 28 Jan – Tue 3 Feb leave → 3", "2026-01-01", "2026-01-31", 3],
    ["February month → 2", "2026-02-01", "2026-02-28", 2],
    ["whole quarter → 5", "2026-01-01", "2026-03-31", 5],
    ["custom period cutting the leave mid-week (29 Jan – 2 Feb) → 3", "2026-01-29", "2026-02-02", 3],
    ["period outside the leave → 0", "2026-03-01", "2026-03-31", 0],
  ])("%s", (_name, from, to, expected) => {
    expect(daysInPeriod(leave(), { from, to })).toBe(expected);
  });

  it("keeps the half-day edges on the real first and last day", () => {
    const l = leave({ startHalf: "pm", endHalf: "am" }); // 0.5 + 1 + 1 | 1 + 0.5
    expect(daysInPeriod(l, { from: "2026-01-01", to: "2026-01-31" })).toBe(2.5);
    expect(daysInPeriod(l, { from: "2026-02-01", to: "2026-02-28" })).toBe(1.5);
  });

  it("matches monthSplit for whole months and sums to the leave total", () => {
    const cases = [
      leave(),
      leave({ startDate: "2025-12-24", endDate: "2026-01-09", holidays: [{ date: "2026-01-01", isHalfDay: false }] }),
      leave({ startDate: "2028-02-27", endDate: "2028-03-02", mode: "calendar", startHalf: "pm" }),
    ];
    for (const l of cases) {
      const split = monthSplit(l);
      let total = 0;
      for (const [month, days] of split) {
        const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
        const d = daysInPeriod(l, { from: `${month}-01`, to: end });
        expect(d).toBe(days);
        total += d;
      }
      expect(total).toBe(workingDays(l).days);
    }
  });
});

describe("periodSpanDays", () => {
  it("counts both ends", () => {
    expect(periodSpanDays({ from: "2026-11-01", to: "2026-11-30" })).toBe(30);
    expect(periodSpanDays({ from: "2028-01-01", to: "2028-12-31" })).toBe(366);
  });
});
