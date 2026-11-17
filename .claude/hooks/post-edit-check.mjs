#!/usr/bin/env node
// PostToolUse check for Edit | Write | MultiEdit on TypeScript files.
// Runs ESLint on the file, typecheck on its workspace, and related Vitest tests for
// shared/ and server/src/domain/. On failure: exit 2 so the output is fed back to Claude.
// Does nothing until the repo is scaffolded (no node_modules or no workspace package.json).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const raw = await new Promise((resolve) => {
  let data = "";
  process.stdin.on("data", (c) => (data += c));
  process.stdin.on("end", () => resolve(data));
});

let input;
try {
  input = JSON.parse(raw || "{}");
} catch {
  process.exit(0);
}

const filePath = input.tool_input?.file_path ?? "";
if (!/\.(ts|tsx|mts|cts)$/.test(filePath)) process.exit(0);

const norm = (p) =>
  String(p).replace(/\\/g, "/").replace(/^\/([a-zA-Z])\//, "$1:/").replace(/\/+$/, "");
const root = norm(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
const abs = norm(filePath);
if (!abs.toLowerCase().startsWith(root.toLowerCase() + "/")) process.exit(0);
const rel = abs.slice(root.length + 1);
const ws = ["shared", "server", "web"].find((w) => rel.startsWith(`${w}/`));
if (!ws) process.exit(0);

if (!existsSync(join(root, "node_modules")) || !existsSync(join(root, ws, "package.json"))) {
  process.exit(0); // not scaffolded yet
}

const pkg = `@leave/${ws}`;
const failures = [];

function run(label, args, cwd = root) {
  const r = spawnSync("pnpm", args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, TZ: "UTC", FORCE_COLOR: "0" },
    timeout: 200_000,
  });
  if (r.status !== 0) {
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    failures.push(`### ${label} failed\n${out.slice(-3500)}`);
  }
}

const hasEslint = ["eslint.config.js", "eslint.config.mjs", "eslint.config.ts"].some((f) =>
  existsSync(join(root, f))
);
if (hasEslint) run("eslint", ["--silent", "exec", "eslint", "--no-warn-ignored", `"${filePath}"`]);

run(`typecheck ${pkg}`, ["--silent", "--filter", pkg, "run", "--if-present", "typecheck"]);

if (rel.startsWith("shared/") || rel.startsWith("server/src/domain/")) {
  run(`vitest related (${rel})`, [
    "--silent", "--filter", pkg, "exec", "vitest", "related", `"${filePath}"`, "--run", "--passWithNoTests",
  ]);
}

if (failures.length) {
  process.stderr.write(`Post-edit checks for ${rel}:\n\n${failures.join("\n\n")}\n\nFix these before continuing.\n`);
  process.exit(2);
}
process.exit(0);
