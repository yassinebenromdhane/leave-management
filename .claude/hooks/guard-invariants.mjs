#!/usr/bin/env node
// PreToolUse guard for Edit | Write | MultiEdit.
// Blocks (exit 2, reason on stderr) writes that break the hard invariants in CLAUDE.md.
// Only the NEW text being written is scanned, so pre-existing code never blocks an unrelated edit.

const raw = await new Promise((resolve) => {
  let data = "";
  process.stdin.on("data", (c) => (data += c));
  process.stdin.on("end", () => resolve(data));
});

let input;
try {
  input = JSON.parse(raw || "{}");
} catch {
  process.exit(0); // never block on a malformed payload
}

const ti = input.tool_input ?? {};
const filePath = ti.file_path ?? "";
if (!filePath) process.exit(0);

// Normalise Windows (C:\x, c:\x) and Git-Bash (/c/x) paths before comparing.
const norm = (p) =>
  String(p).replace(/\\/g, "/").replace(/^\/([a-zA-Z])\//, "$1:/").replace(/\/+$/, "");
const root = norm(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
const abs = norm(filePath);
const rel = abs.toLowerCase().startsWith(root.toLowerCase() + "/")
  ? abs.slice(root.length + 1)
  : abs; // outside the project: rules below simply won't match

const newText = [
  ti.content,
  ti.new_string,
  ...(Array.isArray(ti.edits) ? ti.edits.map((e) => e?.new_string) : []),
]
  .filter((s) => typeof s === "string")
  .join("\n");

const violations = [];
const block = (msg) => violations.push(msg);
const has = (re) => re.test(newText);

// 1. Secrets
if (/(^|\/)\.env(\.(?!example$)[^/]+)?$/.test(rel)) {
  block("Do not write .env files. Update .env.example and ask the user to set real values.");
}

// 2. Generated migrations are owned by drizzle-kit
if (rel.startsWith("server/drizzle/")) {
  block("server/drizzle/ is generated. Edit server/src/db/schema.ts and run `pnpm --filter @leave/server db:generate` (see /add-migration).");
}

// 3. shared/ must stay pure (CLAUDE.md invariant 4)
if (rel.startsWith("shared/")) {
  const forbidden = /from\s+['"](hono(\/[^'"]*)?|react(-dom)?(\/[^'"]*)?|drizzle-orm[^'"]*|pg|postgres|better-auth[^'"]*|nodemailer|exceljs|node:[^'"]+|fs|path|@leave\/(server|web)[^'"]*)['"]/;
  if (has(forbidden)) {
    block("shared/ is pure TypeScript: only zod and date-fns may be imported (no framework, DB, Node or I/O imports).");
  }
}

// 4. Ledger is append-only; leave requests are soft-deleted (invariants 2, 9)
if (rel.startsWith("server/")) {
  if (has(/\.(update|delete)\(\s*ledgerEntr(y|ies)\b/) || has(/\b(UPDATE\s+"?ledger_entry"?|DELETE\s+FROM\s+"?ledger_entry"?)/i)) {
    block("ledger_entry is append-only. Write a `reversal` entry instead of UPDATE/DELETE (spec 4.2 rules 4-5).");
  }
  if (has(/\.delete\(\s*leaveRequests?\b/) || has(/DELETE\s+FROM\s+"?leave_request"?/i)) {
    block("leave_request is soft-deleted: set deleted_at instead of DELETE.");
  }
  if (has(/\.delete\(\s*employees?\b/) || has(/DELETE\s+FROM\s+"?employee"?/i)) {
    block("Employees are archived (status = 'archived'), never deleted.");
  }
}

// 5. Portal routes take the employee id from the session only (invariant 5)
if (rel.startsWith("server/src/routes/portal/")) {
  if (has(/req\.(param|query)\(\s*['"]employee_?[iI]d['"]/) || has(/req\.valid\(\s*['"](param|query|json|form)['"]\s*\)\s*\.\s*employee_?[iI]d/)) {
    block("Portal routes must read employeeId from the session (c.get('session')), never from URL, query or body (spec 4.3).");
  }
}

// 6. web/ boundaries (invariant 10)
if (rel.startsWith("web/")) {
  if (has(/import\s+(?!type\b)[^;]*?from\s+['"]@leave\/server[^'"]*['"]/)) {
    block("web/ may only `import type { AppType } from '@leave/server'`; runtime imports of server code are forbidden.");
  }
  if (rel.startsWith("web/src/operator/") && has(/from\s+['"][^'"]*\/portal(\/|['"])/)) {
    block("web/src/operator must not import from web/src/portal. Move shared pieces to web/src/common.");
  }
  if (rel.startsWith("web/src/portal/") && has(/from\s+['"][^'"]*\/operator(\/|['"])/)) {
    block("web/src/portal must not import from web/src/operator. Move shared pieces to web/src/common.");
  }
  if (rel.startsWith("web/src/common/") && has(/from\s+['"][^'"]*\/(operator|portal)(\/|['"])/)) {
    block("web/src/common must not depend on operator/ or portal/.");
  }
  if (rel.startsWith("web/src/common/components/") && has(/from\s+['"](@tanstack\/react-query|[^'"]*common\/api[^'"]*|hono\/client)['"]/)) {
    block("web/src/common/components are props-only: no data fetching or query hooks inside them.");
  }
}

if (violations.length) {
  process.stderr.write(
    `Blocked by .claude/hooks/guard-invariants.mjs (${rel}):\n- ${violations.join("\n- ")}\n`
  );
  process.exit(2);
}
process.exit(0);
