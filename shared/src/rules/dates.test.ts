import { describe, expect, it } from "vitest";
import { isValidIsoDate } from "./dates";

describe("isValidIsoDate", () => {
  it.each(["2024-02-29", "2025-12-31", "2026-01-01"])("accepts %s", (d) => {
    expect(isValidIsoDate(d)).toBe(true);
  });

  // Impossible calendar dates must return false, never throw (a throw became an API 500).
  it.each(["2024-02-30", "2025-02-29", "2025-04-31", "2025-13-01", "2025-1-01", "", "nope"])("rejects %j", (d) => {
    expect(isValidIsoDate(d)).toBe(false);
  });
});
