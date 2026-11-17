import { describe, expect, it } from "vitest";
import type { HalfDay } from "../types";
import { WEEK_PRESETS, type WeekMask } from "../weekMask";
import { addIsoDays } from "./dates";
import { monthSplit } from "./monthSplit";
import { workingDays, type DayCountInput } from "./workingDays";

const base = (over: Partial<DayCountInput>): DayCountInput => ({
  startDate: "2026-01-28",
  endDate: "2026-02-03",
  startHalf: "full",
  endHalf: "full",
  mode: "working",
  workDays: WEEK_PRESETS.monFri,
  holidays: [],
  ...over,
});

const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe("monthSplit (rule 9)", () => {
  it("splits a leave across two months day by day", () => {
    // Wed 28, Thu 29, Fri 30 Jan | Mon 2, Tue 3 Feb
    expect([...monthSplit(base({}))]).toEqual([
      ["2026-01", 3],
      ["2026-02", 2],
    ]);
  });

  it("puts the half-day edges in the right month", () => {
    expect([...monthSplit(base({ startHalf: "pm", endHalf: "am" }))]).toEqual([
      ["2026-01", 2.5],
      ["2026-02", 1.5],
    ]);
  });

  it("crosses the year", () => {
    expect([...monthSplit(base({ startDate: "2025-12-31", endDate: "2026-01-02", holidays: [{ date: "2026-01-01", isHalfDay: false }] }))]).toEqual([
      ["2025-12", 1],
      ["2026-01", 1],
    ]);
  });

  it("property: monthly totals always sum to workingDays (2000 seeded random leaves)", () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const masks: WeekMask[] = [WEEK_PRESETS.monFri, WEEK_PRESETS.monSat, WEEK_PRESETS.sunThu];
    for (let i = 0; i < 2000; i++) {
      const startDate = addIsoDays("2025-11-01", Math.floor(rand() * 500));
      const len = Math.floor(rand() * 70);
      const endDate = addIsoDays(startDate, len);
      const startHalf: HalfDay = len === 0 ? (["full", "am", "pm"] as const)[Math.floor(rand() * 3)]! : rand() < 0.5 ? "full" : "pm";
      const endHalf: HalfDay = len === 0 ? startHalf : rand() < 0.5 ? "full" : "am";
      const holidays = Array.from({ length: Math.floor(rand() * 4) }, () => ({
        date: addIsoDays(startDate, Math.floor(rand() * (len + 1))),
        isHalfDay: rand() < 0.3,
      }));
      const input = base({ startDate, endDate, startHalf, endHalf, holidays, workDays: masks[i % 3]!, mode: rand() < 0.2 ? "calendar" : "working" });
      expect(total(monthSplit(input)), JSON.stringify(input)).toBe(workingDays(input).days);
    }
  });
});
