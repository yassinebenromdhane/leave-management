import { describe, expect, it } from "vitest";
import app from "./app";
import { fromDays, toDays } from "./db/days";

describe("api", () => {
  it("GET /api/health returns ok", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("day amount conversion", () => {
  it.each([
    ["4.5", 4.5],
    ["-2.0", -2],
    ["0.0", 0],
  ])("toDays(%s) = %s", (raw, expected) => {
    expect(toDays(raw)).toBe(expected);
  });

  it("rejects non half-day values", () => {
    expect(() => fromDays(0.3)).toThrow();
    expect(() => toDays("1.2")).toThrow();
  });

  it("formats with one decimal", () => {
    expect(fromDays(-7.5)).toBe("-7.5");
    expect(fromDays(3)).toBe("3.0");
  });
});
