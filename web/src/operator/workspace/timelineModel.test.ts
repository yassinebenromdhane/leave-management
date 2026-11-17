import { describe, expect, it } from "vitest";
import { barGeometry, buildColumns, offCount, periodRange, shiftAnchor } from "./timelineModel";

type Half = "full" | "am" | "pm";
const span = (startDate: string, endDate: string, startHalf: Half = "full", endHalf: Half = "full") => ({ startDate, endDate, startHalf, endHalf });

describe("barGeometry (week of Mon 2026-11-16)", () => {
  const from = "2026-11-16";
  const to = "2026-11-22";

  it("full days span whole columns", () => {
    expect(barGeometry(span("2026-11-17", "2026-11-19"), from, to)).toMatchObject({ left: 1, width: 3 });
  });
  it("single-day am is the left half, pm the right half", () => {
    expect(barGeometry(span("2026-11-18", "2026-11-18", "am", "am"), from, to)).toMatchObject({ left: 2, width: 0.5 });
    expect(barGeometry(span("2026-11-18", "2026-11-18", "pm", "pm"), from, to)).toMatchObject({ left: 2.5, width: 0.5 });
  });
  it("multi-day starting pm begins mid-cell, ending am stops mid-cell", () => {
    expect(barGeometry(span("2026-11-17", "2026-11-19", "pm", "am"), from, to)).toMatchObject({ left: 1.5, width: 2 });
  });
  it("clips to the period and flags the cut edges", () => {
    expect(barGeometry(span("2026-11-10", "2026-11-17"), from, to)).toEqual({ left: 0, width: 2, clippedStart: true, clippedEnd: false });
    expect(barGeometry(span("2026-11-21", "2026-11-30"), from, to)).toEqual({ left: 5, width: 2, clippedStart: false, clippedEnd: true });
  });
  it("is null outside the period", () => {
    expect(barGeometry(span("2026-11-01", "2026-11-15"), from, to)).toBeNull();
    expect(barGeometry(span("2026-11-23", "2026-11-24"), from, to)).toBeNull();
  });
});

describe("columns and shading", () => {
  const holidays = [{ date: "2026-11-11", name: "Armistice", isHalfDay: false }];
  const cols = buildColumns("2026-11-09", "2026-11-15", 31, holidays, "2026-11-12");

  it("shades weekends (outside the work pattern) and holidays, with the holiday name", () => {
    expect(cols.map((c) => c.shaded)).toEqual([false, false, true, false, false, true, true]);
    expect(cols[2]!.holiday).toBe("Armistice");
    expect(cols[3]!.holiday).toBeNull();
  });
  it("marks today", () => {
    expect(cols.filter((c) => c.isToday).map((c) => c.date)).toEqual(["2026-11-12"]);
  });
  it("follows the company work pattern (Sun-Thu)", () => {
    // bits: Mon=1 Tue=2 Wed=4 Thu=8 Fri=16 Sat=32 Sun=64 -> Sun-Thu = 64+1+2+4+8
    const gulf = buildColumns("2026-11-12", "2026-11-14", 79, [], "2026-11-01");
    expect(gulf.map((c) => c.shaded)).toEqual([false, true, true]); // Thu, Fri, Sat
  });
});

describe("periods", () => {
  it("week starts Monday, month covers the whole month", () => {
    expect(periodRange("2026-11-18", "week")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(periodRange("2026-11-18", "month")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  });
  it("shifts by a week or a month", () => {
    expect(shiftAnchor("2026-11-18", "week", 1)).toBe("2026-11-25");
    expect(shiftAnchor("2026-11-18", "month", -1)).toBe("2026-10-01");
  });
  it("offCount counts distinct people", () => {
    const l = [
      { employeeId: "a", startDate: "2026-11-16", endDate: "2026-11-18" },
      { employeeId: "a", startDate: "2026-11-17", endDate: "2026-11-17" },
      { employeeId: "b", startDate: "2026-11-17", endDate: "2026-11-17" },
    ];
    expect(offCount("2026-11-17", l)).toBe(2);
    expect(offCount("2026-11-19", l)).toBe(0);
  });
});
