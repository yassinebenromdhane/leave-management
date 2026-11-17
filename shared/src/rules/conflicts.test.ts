import { describe, expect, it } from "vitest";
import { evaluateLeave, spansOverlap, type EvaluateInput } from "./conflicts";
import type { LeaveSpan } from "./workingDays";

const span = (startDate: string, endDate: string, startHalf: LeaveSpan["startHalf"] = "full", endHalf: LeaveSpan["endHalf"] = startDate === endDate ? startHalf : "full"): LeaveSpan => ({
  startDate,
  endDate,
  startHalf,
  endHalf,
});

const input = (over: Partial<EvaluateInput> = {}): EvaluateInput => ({
  context: "operator",
  span: span("2026-01-12", "2026-01-16"),
  days: 5,
  employment: { hireDate: "2024-01-01", endDate: null },
  ownLeaves: [],
  balance: { available: 12 },
  settings: { allowNegative: false, negativeLimitDays: 0 },
  department: { name: "Logistics", size: 5, colleaguesOff: [] },
  attachment: { required: false, present: false, isSickLeave: false },
  ...over,
});

const codes = (r: ReturnType<typeof evaluateLeave>) => ({
  blocking: r.blocking.map((i) => i.code),
  warnings: r.warnings.map((i) => i.code),
});

describe("spansOverlap at half-day precision", () => {
  it.each([
    [span("2026-01-12", "2026-01-12", "am"), span("2026-01-12", "2026-01-12", "pm"), false],
    [span("2026-01-12", "2026-01-12", "am"), span("2026-01-12", "2026-01-12", "am"), true],
    [span("2026-01-12", "2026-01-14", "full", "am"), span("2026-01-14", "2026-01-16", "pm"), false],
    [span("2026-01-12", "2026-01-14"), span("2026-01-14", "2026-01-16", "pm"), true],
    [span("2026-01-12", "2026-01-13"), span("2026-01-14", "2026-01-15"), false],
  ])("%o vs %o → %s", (a, b, expected) => {
    expect(spansOverlap(a, b)).toBe(expected);
    expect(spansOverlap(b, a)).toBe(expected);
  });
});

describe("evaluateLeave (spec 1.3)", () => {
  it("clean leave has no issues", () => {
    expect(codes(evaluateLeave(input()))).toEqual({ blocking: [], warnings: [] });
  });

  it("blocks self-overlap and links to the existing leave", () => {
    const r = evaluateLeave(input({ ownLeaves: [{ id: "L1", leaveTypeName: "Paid leave", ...span("2026-01-14", "2026-01-20") }] }));
    expect(r.blocking[0]).toMatchObject({ code: "conflicts.selfOverlap", params: { leaveId: "L1", start: "2026-01-14" } });
  });

  it("blocks zero working days and leave outside the employment period", () => {
    expect(codes(evaluateLeave(input({ days: 0 }))).blocking).toEqual(["conflicts.zeroDays"]);
    expect(codes(evaluateLeave(input({ employment: { hireDate: "2026-01-13", endDate: null } }))).blocking).toEqual(["conflicts.outsideEmployment"]);
    expect(codes(evaluateLeave(input({ employment: { hireDate: "2020-01-01", endDate: "2026-01-15" } }))).blocking).toEqual(["conflicts.outsideEmployment"]);
  });

  it.each([
    ["negatives disabled → blocking", { allowNegative: false, negativeLimitDays: 0 }, "blocking"],
    ["allowed within the limit → warning", { allowNegative: true, negativeLimitDays: 2 }, "warning"],
    ["allowed but beyond the limit → blocking", { allowNegative: true, negativeLimitDays: 1 }, "blocking"],
  ] as const)("balance 3.5 for 5 days: %s", (_n, settings, severity) => {
    const r = evaluateLeave(input({ balance: { available: 3.5 }, settings }));
    const issue = [...r.blocking, ...r.warnings].find((i) => i.code === "conflicts.negativeBalance");
    expect(issue).toMatchObject({ severity, params: { exceeds: 1.5 } });
  });

  it("ignores the balance for types that do not deduct", () => {
    expect(codes(evaluateLeave(input({ balance: null, days: 50 })))).toEqual({ blocking: [], warnings: [] });
  });

  it("warns about colleagues off in the same department", () => {
    const r = evaluateLeave(
      input({
        department: {
          name: "Logistics",
          size: 5,
          colleaguesOff: [
            { name: "Sami", startDate: "2026-01-12", endDate: "2026-01-16" },
            { name: "Ines", startDate: "2026-01-14", endDate: "2026-01-14" },
            { name: "Omar", startDate: "2026-02-01", endDate: "2026-02-02" },
          ],
        },
      }),
    );
    expect(r.warnings[0]).toMatchObject({ code: "conflicts.colleaguesOff", params: { count: 2, size: 5, department: "Logistics" } });
  });

  it.each([
    ["operator, any type → warning", "operator", false, "warning"],
    ["portal, sick leave → warning (certificate expected)", "portal", true, "warning"],
    ["portal, other type → blocking", "portal", false, "blocking"],
  ] as const)("missing required attachment: %s", (_n, context, isSickLeave, severity) => {
    const r = evaluateLeave(input({ context, attachment: { required: true, present: false, isSickLeave } }));
    expect([...r.blocking, ...r.warnings].find((i) => i.code === "conflicts.attachmentMissing")?.severity).toBe(severity);
  });
});
