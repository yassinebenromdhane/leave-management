// Every i18n error code the server (or the shared Zod schemas) can send must be translated in both locales.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "./en.json";
import fr from "./fr.json";

const root = join(process.cwd(), "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" || name === "dist" ? [] : files(p);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [p] : [];
  });
}

const lookup = (dict: unknown, key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict);

describe("server error codes", () => {
  const codes = new Set<string>();
  const pattern = /["']([a-zA-Z]+\.errors\.[a-zA-Z]+)["']/g;
  for (const dir of ["server/src", "shared/src"]) {
    for (const f of files(join(root, dir))) {
      for (const m of readFileSync(f, "utf8").matchAll(pattern)) codes.add(m[1]!);
    }
  }

  it("finds codes to check", () => expect(codes.size).toBeGreaterThan(20));

  it("each has a translation in fr and en", () => {
    const missing = [...codes].filter((c) => typeof lookup(en, c) !== "string" || typeof lookup(fr, c) !== "string");
    expect(missing).toEqual([]);
  });
});
