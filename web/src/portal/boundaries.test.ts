// CLAUDE.md invariant 10: operator/ and portal/ never import each other, and common/ imports
// neither. This is what keeps operator code out of the lazy portal chunk.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(process.cwd(), "src");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
const importsOf = (file: string) => [...readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]!);

describe("web boundaries", () => {
  it("portal never imports operator", () => {
    const bad = files(join(src, "portal")).flatMap((f) => importsOf(f).filter((i) => /(^|\/)operator(\/|$)/.test(i)).map((i) => `${f} -> ${i}`));
    expect(bad).toEqual([]);
  });

  it("operator never imports portal", () => {
    const bad = files(join(src, "operator")).flatMap((f) => importsOf(f).filter((i) => /(^|\/)portal(\/|$)/.test(i)).map((i) => `${f} -> ${i}`));
    expect(bad).toEqual([]);
  });

  it("common imports neither surface, and @leave/server only as a type", () => {
    for (const f of files(join(src, "common"))) {
      const bad = importsOf(f).filter((i) => /(^|\/)(operator|portal)(\/|$)/.test(i));
      expect(bad, f).toEqual([]);
    }
    for (const f of files(src)) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/^import(?!\s+type)[^;]*from\s+["']@leave\/server["']/m);
    }
  });

  it("common/components stay props-only (no fetching)", () => {
    for (const f of files(join(src, "common", "components"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/useQuery|useMutation|common\/api\/client/);
    }
  });
});
