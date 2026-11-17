import { describe, expect, it } from "vitest";
import en from "./en.json";
import fr from "./fr.json";

function keys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === "object"
      ? keys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe("i18n parity", () => {
  it("fr and en define exactly the same keys", () => {
    expect(keys(en).sort()).toEqual(keys(fr).sort());
  });

  it("no empty translations", () => {
    for (const dict of [fr, en]) {
      for (const k of keys(dict)) {
        const value = k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], dict);
        expect(value, k).not.toBe("");
      }
    }
  });
});
