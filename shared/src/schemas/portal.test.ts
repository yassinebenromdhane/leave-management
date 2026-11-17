import { describe, expect, it } from "vitest";
import {
  awayEntrySchema,
  portalLeaveSubmitSchema,
  portalPreviewSchema,
  portalTeamQuerySchema,
  portalTeamResponseSchema,
} from "./portal";

const TYPE = "4c1d3f0e-8a3b-4d3e-9b1a-2f1e0c9d8b7a";
const EMP = "9f1d3f0e-8a3b-4d3e-9b1a-2f1e0c9d8b7a";

describe("portalLeaveSubmitSchema", () => {
  it("accepts a minimal request and defaults halves and acknowledgeNegative", () => {
    const v = portalLeaveSubmitSchema.parse({ leaveTypeId: TYPE, startDate: "2026-03-02", endDate: "2026-03-06" });
    expect(v).toMatchObject({ startHalf: "full", endHalf: "full", acknowledgeNegative: false, note: null });
  });

  it("rejects an employeeId (the server takes it from the session)", () => {
    const r = portalLeaveSubmitSchema.safeParse({
      employeeId: EMP,
      leaveTypeId: TYPE,
      startDate: "2026-03-02",
      endDate: "2026-03-02",
    });
    expect(r.success).toBe(false);
  });

  it.each([
    ["end before start", { startDate: "2026-03-05", endDate: "2026-03-02" }, "leave.errors.endBeforeStart"],
    ["pm start + am end on one day", { startDate: "2026-03-02", endDate: "2026-03-02", startHalf: "pm", endHalf: "am" }, "leave.errors.invalidHalfDays"],
  ])("%s → %s", (_n, span, message) => {
    const r = portalLeaveSubmitSchema.safeParse({ leaveTypeId: TYPE, ...span });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe(message);
  });

  it("preview rejects an employeeId too", () => {
    expect(portalPreviewSchema.safeParse({ employeeId: EMP, leaveTypeId: TYPE, startDate: "2026-03-02", endDate: "2026-03-02" }).success).toBe(false);
  });
});

describe("portalTeamQuerySchema", () => {
  it.each([
    ["31 days", { from: "2026-03-01", to: "2026-03-31" }, true],
    ["32 days", { from: "2026-03-01", to: "2026-04-01" }, false],
    ["reversed", { from: "2026-03-10", to: "2026-03-01" }, false],
    ["one day", { from: "2026-03-10", to: "2026-03-10" }, true],
  ])("%s", (_n, q, ok) => {
    expect(portalTeamQuerySchema.safeParse(q).success).toBe(ok);
  });
});

describe("Away projection", () => {
  const away = {
    employeeId: EMP,
    fullName: "Bob",
    startDate: "2026-03-02",
    endDate: "2026-03-03",
    startHalf: "full",
    endHalf: "am",
  };

  it("accepts exactly the six keys", () => {
    expect(awayEntrySchema.parse(away)).toEqual(away);
  });

  it.each(["leaveTypeId", "note", "status", "attachmentCount", "rejectReason"])("rejects an extra %s key", (key) => {
    expect(awayEntrySchema.safeParse({ ...away, [key]: "x" }).success).toBe(false);
    expect(portalTeamResponseSchema.safeParse({ scope: "department", people: [{ ...away, [key]: "x" }] }).success).toBe(false);
  });
});
