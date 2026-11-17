import { WEEK_PRESETS } from "@leave/shared";
import { describe, expect, it } from "vitest";
import { toggleWeekday, workdaysOf } from "./workWeek";

describe("working-week toggles over the bitmask", () => {
  it("Monday is bit 0 and Sunday bit 6", () => {
    expect(toggleWeekday(0b0111110, 1)).toBe(0b0111111);
    expect(toggleWeekday(0b0111110, 7)).toBe(0b1111110);
  });

  it("round-trips the presets", () => {
    expect(workdaysOf(WEEK_PRESETS.monFri)).toEqual([1, 2, 3, 4, 5]);
    expect(workdaysOf(WEEK_PRESETS.sunThu)).toEqual([1, 2, 3, 4, 7]);
    expect(toggleWeekday(WEEK_PRESETS.monFri, 6)).toBe(WEEK_PRESETS.monSat);
    expect(toggleWeekday(WEEK_PRESETS.monSat, 6)).toBe(WEEK_PRESETS.monFri);
  });

  it("refuses to switch off the last working day", () => {
    expect(toggleWeekday(0b0000001, 1)).toBe(0b0000001);
  });
});
