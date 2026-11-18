// Half-day unit helpers (CLAUDE.md invariant 7): day amounts are 0.5 steps, summed as integer halves.
import { describe, expect, it } from "vitest";
import { fromHalves, isHalfStep, sumDays, toHalves } from "./halfDays";

describe("toHalves / fromHalves", () => {
  it.each([
    [0, 0],
    [0.5, 1],
    [1, 2],
    [4.5, 9],
    [-2.5, -5],
    [366, 732],
  ])("%s days ↔ %s halves", (days, halves) => {
    expect(toHalves(days)).toBe(halves);
    expect(fromHalves(halves)).toBe(days);
  });

  it.each([0.25, 1.1, 0.3, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s (not a 0.5-day step)", (days) => {
    expect(() => toHalves(days)).toThrow(/0\.5-day step/);
  });
});

describe("isHalfStep", () => {
  it.each([
    [0, true],
    [0.5, true],
    [-1.5, true],
    [25, true],
    [0.25, false],
    [2.3, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
  ])("%s → %s", (days, expected) => {
    expect(isHalfStep(days)).toBe(expected);
  });
});

describe("sumDays", () => {
  it("is exact where floating-point accumulation drifts", () => {
    const values = Array.from({ length: 1000 }, (_, i) => (i % 2 === 0 ? 0.5 : 1.5)); // 500 × 2 = 1000
    expect(sumDays(values)).toBe(1000);
  });

  it("handles signed ledger amounts (grants and consumption cancel exactly)", () => {
    expect(sumDays([20, -4.5, -0.5, 2.5, -17.5])).toBe(0);
  });

  it("empty → 0", () => {
    expect(sumDays([])).toBe(0);
  });

  it("throws on a non-0.5 amount instead of hiding it in the total", () => {
    expect(() => sumDays([1, 0.3])).toThrow(/0\.5-day step/);
  });
});
