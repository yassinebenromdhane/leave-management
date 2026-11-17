import { describe, expect, it } from "vitest";
import { WEEK_PRESETS, isValidWeekMask, isWorkWeekday, maskFromWeekdays } from "./weekMask";

describe("week mask (bit 0 = Monday … bit 6 = Sunday)", () => {
  it.each([
    ["Mon–Fri", WEEK_PRESETS.monFri, 0b0011111],
    ["Mon–Sat", WEEK_PRESETS.monSat, 0b0111111],
    ["Sun–Thu", WEEK_PRESETS.sunThu, 0b1001111],
  ])("%s preset = %i", (_name, mask, expected) => {
    expect(mask).toBe(expected);
  });

  it.each([
    [WEEK_PRESETS.monFri, 5, true],
    [WEEK_PRESETS.monFri, 6, false],
    [WEEK_PRESETS.monFri, 7, false],
    [WEEK_PRESETS.sunThu, 7, true],
    [WEEK_PRESETS.sunThu, 5, false],
  ] as const)("mask %i, ISO weekday %i → working %s", (mask, day, expected) => {
    expect(isWorkWeekday(mask, day)).toBe(expected);
  });

  it("round-trips weekdays", () => {
    expect(maskFromWeekdays([1, 3, 5])).toBe(0b0010101);
  });

  it.each([
    [0, false],
    [128, false],
    [1.5, false],
    [31, true],
    [127, true],
  ])("isValidWeekMask(%s) = %s", (mask, ok) => {
    expect(isValidWeekMask(mask)).toBe(ok);
  });
});
