import { describe, expect, it } from "vitest";
import { leaveCreateSchema, leavePreviewSchema, MAX_LEAVE_SPAN_DAYS } from "./domain";
import { portalPreviewSchema } from "./portal";

const ids = { employeeId: "00000000-0000-4000-8000-000000000001", leaveTypeId: "00000000-0000-4000-8000-000000000002" };

describe("leave span cap (security audit, step 5)", () => {
  it("accepts exactly 366 days", () => {
    expect(MAX_LEAVE_SPAN_DAYS).toBe(366);
    expect(leaveCreateSchema.safeParse({ ...ids, startDate: "2028-01-01", endDate: "2028-12-31" }).success).toBe(true); // leap year
  });

  it.each([
    ["operator create", leaveCreateSchema, ids],
    ["operator preview", leavePreviewSchema, ids],
    ["portal preview", portalPreviewSchema, { leaveTypeId: ids.leaveTypeId }],
  ] as const)("%s rejects a span longer than a year with leave.errors.tooLong", (_n, schema, base) => {
    const r = schema.safeParse({ ...base, startDate: "2000-01-01", endDate: "2099-12-31" });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain("leave.errors.tooLong");
  });
});
