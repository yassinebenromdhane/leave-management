import { describe, expect, it } from "vitest";
import type { HalfDay } from "../types";
import { WEEK_PRESETS } from "../weekMask";
import { isValidHalfCombination, workingDays, type HolidayDay } from "./workingDays";

const MON_FRI = WEEK_PRESETS.monFri;
// January 2026: Thu 1 (holiday below), Fri 2, Sat 3, Sun 4, Mon 5 … Fri 9, Sat 10, Sun 11, Mon 12 … Fri 16
const NEW_YEAR: HolidayDay = { date: "2026-01-01", isHalfDay: false };

const count = (
  startDate: string,
  endDate: string,
  startHalf: HalfDay = "full",
  endHalf: HalfDay = startDate === endDate ? startHalf : "full",
  opts: { mode?: "working" | "calendar"; workDays?: number; holidays?: HolidayDay[] } = {},
) =>
  workingDays({
    startDate,
    endDate,
    startHalf,
    endHalf,
    mode: opts.mode ?? "working",
    workDays: opts.workDays ?? MON_FRI,
    holidays: opts.holidays ?? [],
  });

describe("workingDays: single day", () => {
  it.each([
    ["full Monday", "full", 1],
    ["morning only", "am", 0.5],
    ["afternoon only", "pm", 0.5],
  ] as const)("%s → %s", (_n, half, expected) => {
    expect(count("2026-01-12", "2026-01-12", half).days).toBe(expected);
  });

  it("a Saturday counts 0 (blocking 'no working days' is decided by the caller)", () => {
    expect(count("2026-01-10", "2026-01-10")).toEqual({ days: 0, weekendDays: 1, holidayDays: 0 });
  });

  it("a full holiday counts 0", () => {
    expect(count("2026-01-01", "2026-01-01", "full", "full", { holidays: [NEW_YEAR] })).toEqual({ days: 0, weekendDays: 0, holidayDays: 1 });
  });

  it.each([
    ["full", 0.5],
    ["am", 0.5],
    ["pm", 0.5],
  ] as const)("half-day holiday taken as %s → %s (never more than the day is worth)", (half, expected) => {
    expect(count("2026-01-12", "2026-01-12", half, half, { holidays: [{ date: "2026-01-12", isHalfDay: true }] }).days).toBe(expected);
  });
});

describe("workingDays: ranges", () => {
  it.each([
    ["Mon–Fri week", "2026-01-12", "2026-01-16", "full", "full", 5],
    ["Mon–Sun spans a weekend", "2026-01-12", "2026-01-18", "full", "full", 5],
    ["Fri–Mon", "2026-01-09", "2026-01-12", "full", "full", 2],
    ["pm start", "2026-01-12", "2026-01-16", "pm", "full", 4.5],
    ["am end", "2026-01-12", "2026-01-16", "full", "am", 4.5],
    ["pm start and am end", "2026-01-12", "2026-01-16", "pm", "am", 4],
    ["two days pm→am = one day", "2026-01-12", "2026-01-13", "pm", "am", 1],
    ["weekend only", "2026-01-10", "2026-01-11", "full", "full", 0],
  ] as const)("%s → %s", (_n, s, e, sh, eh, expected) => {
    expect(count(s, e, sh, eh).days).toBe(expected);
  });

  it("produces the counters for the UI sentence 'N working days (W weekend, H public holiday excluded)'", () => {
    // Wed 31 Dec 2025 pm → Tue 6 Jan 2026: Wed 0.5, Thu holiday 0, Fri 1, Sat+Sun weekend, Mon 1, Tue 1 = 3.5
    const r = count("2025-12-31", "2026-01-06", "pm", "full", { holidays: [NEW_YEAR] });
    expect(r).toEqual({ days: 3.5, weekendDays: 2, holidayDays: 1 });
  });

  it("a pm start on a half-day holiday never goes below 0 for that day", () => {
    const r = count("2026-01-12", "2026-01-13", "pm", "full", { holidays: [{ date: "2026-01-12", isHalfDay: true }] });
    expect(r.days).toBe(1);
  });

  it("half-day holiday inside a range counts 0.5", () => {
    expect(count("2026-01-12", "2026-01-16", "full", "full", { holidays: [{ date: "2026-01-14", isHalfDay: true }] }).days).toBe(4.5);
  });

  it.each([
    ["Mon–Sat pattern counts Saturday", WEEK_PRESETS.monSat, "2026-01-12", "2026-01-18", 6],
    ["Sun–Thu pattern", WEEK_PRESETS.sunThu, "2026-01-11", "2026-01-17", 5],
    ["Sun–Thu pattern skips Fri and Sat", WEEK_PRESETS.sunThu, "2026-01-16", "2026-01-17", 0],
  ] as const)("%s", (_n, mask, s, e, expected) => {
    expect(count(s, e, "full", "full", { workDays: mask }).days).toBe(expected);
  });

  it("crosses month and year boundaries", () => {
    expect(count("2025-12-29", "2026-01-02").days).toBe(5);
    expect(count("2025-12-29", "2026-01-02", "full", "full", { holidays: [NEW_YEAR] }).days).toBe(4);
  });

  it("handles leap day", () => {
    expect(count("2028-02-28", "2028-03-01").days).toBe(3); // Mon 28, Tue 29 Feb, Wed 1 Mar
  });
});

describe("workingDays: calendar mode", () => {
  it("counts every date, weekends and holidays included", () => {
    expect(count("2026-01-09", "2026-01-12", "full", "full", { mode: "calendar", holidays: [NEW_YEAR] })).toEqual({
      days: 4,
      weekendDays: 0,
      holidayDays: 0,
    });
  });

  it("still applies the half-day edges", () => {
    expect(count("2026-01-09", "2026-01-12", "pm", "am", { mode: "calendar" }).days).toBe(3);
  });
});

describe("half-day combinations", () => {
  it.each([
    ["2026-01-12", "2026-01-12", "am", "am", true],
    ["2026-01-12", "2026-01-12", "pm", "am", false],
    ["2026-01-12", "2026-01-13", "am", "full", false],
    ["2026-01-12", "2026-01-13", "full", "pm", false],
    ["2026-01-12", "2026-01-13", "pm", "am", true],
    ["2026-01-13", "2026-01-12", "full", "full", false],
  ] as const)("%s %s %s→%s valid=%s", (s, e, sh, eh, ok) => {
    expect(isValidHalfCombination({ startDate: s, endDate: e, startHalf: sh, endHalf: eh })).toBe(ok);
  });

  it("workingDays refuses impossible spans", () => {
    expect(() => count("2026-01-12", "2026-01-12", "pm", "am")).toThrow();
  });
});
