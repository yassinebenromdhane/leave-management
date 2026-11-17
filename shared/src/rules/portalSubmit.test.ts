import { describe, expect, it } from "vitest";
import type { ConflictResult, Issue } from "./conflicts";
import { portalConflictsView, portalSubmitVerdict } from "./portalSubmit";

const issue = (code: Issue["code"], severity: Issue["severity"], params?: Issue["params"]): Issue => ({
  code,
  severity,
  ...(params ? { params } : {}),
});
const result = (blocking: Issue[], warnings: Issue[] = []): ConflictResult => ({ blocking, warnings });

describe("portalSubmitVerdict", () => {
  it.each([
    ["nothing to report → ok", result([]), false, { ok: true }],
    ["self overlap → blocked", result([issue("conflicts.selfOverlap", "blocking")]), true, { ok: false, reason: "blocked" }],
    ["negative beyond limit → blocked even if acknowledged", result([issue("conflicts.negativeBalance", "blocking")]), true, { ok: false, reason: "blocked" }],
    ["allowed negative, not acknowledged → must acknowledge", result([], [issue("conflicts.negativeBalance", "warning")]), false, { ok: false, reason: "acknowledgeNegative" }],
    ["allowed negative, acknowledged → ok", result([], [issue("conflicts.negativeBalance", "warning")]), true, { ok: true }],
    ["colleagues off only → ok (informational)", result([], [issue("conflicts.colleaguesOff", "warning")]), false, { ok: true }],
    ["sick certificate expected → ok", result([], [issue("conflicts.attachmentMissing", "warning")]), false, { ok: true }],
  ] as const)("%s", (_name, conflicts, ack, expected) => {
    expect(portalSubmitVerdict(conflicts, ack)).toEqual(expected);
  });
});

describe("portalConflictsView", () => {
  const colleagues = issue("conflicts.colleaguesOff", "warning", {
    count: 1,
    size: 4,
    department: "Sales",
    people: [{ name: "Bob", start: "2026-03-02", end: "2026-03-03" }],
  });

  it("drops colleague names but keeps the count", () => {
    const view = portalConflictsView(result([], [colleagues]), "department");
    expect(view.warnings[0]!.params).toEqual({ count: 1, size: 4, department: "Sales" });
    expect(JSON.stringify(view)).not.toContain("Bob");
  });

  it("drops the colleagues issue entirely when team visibility is off", () => {
    const view = portalConflictsView(result([], [colleagues, issue("conflicts.negativeBalance", "warning")]), "off");
    expect(view.warnings.map((w) => w.code)).toEqual(["conflicts.negativeBalance"]);
  });

  it("keeps other issues untouched", () => {
    const overlap = issue("conflicts.selfOverlap", "blocking", { leaveId: "x", type: "Paid", start: "a", end: "b" });
    expect(portalConflictsView(result([overlap]), "company")).toEqual(result([overlap]));
  });
});
