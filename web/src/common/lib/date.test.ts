import { describe, expect, it } from "vitest";
import { addMonths, datePreset, monthBounds, todayIso } from "./date";

describe("date helpers", () => {
  it("presets from a Monday", () => {
    // 2026-11-16 is a Monday
    expect(datePreset("today", "2026-11-16")).toEqual({ start: "2026-11-16", end: "2026-11-16" });
    expect(datePreset("tomorrow", "2026-11-16")).toEqual({ start: "2026-11-17", end: "2026-11-17" });
    expect(datePreset("thisWeek", "2026-11-16")).toEqual({ start: "2026-11-16", end: "2026-11-22" });
    expect(datePreset("nextWeek", "2026-11-16")).toEqual({ start: "2026-11-23", end: "2026-11-29" });
  });

  it("next week from a Sunday starts the next day", () => {
    expect(datePreset("nextWeek", "2026-11-22")).toEqual({ start: "2026-11-23", end: "2026-11-29" });
  });

  it("month bounds and navigation", () => {
    expect(monthBounds("2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-01");
  });

  it("todayIso uses the local calendar parts", () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
