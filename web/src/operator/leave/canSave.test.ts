import { describe, expect, it } from "vitest";
import { canSaveLeave, type SaveState } from "./canSave";

const base: SaveState = {
  employeeId: "e1",
  leaveTypeId: "t1",
  start: "2026-01-12",
  end: "2026-01-14",
  halfValid: true,
  days: 3,
  blockingCount: 0,
  saving: false,
};

describe("canSaveLeave", () => {
  it("a blocking issue disables save; warnings never do", () => {
    expect(canSaveLeave(base)).toBe(true);
    expect(canSaveLeave({ ...base, blockingCount: 1 })).toBe(false);
  });

  it("needs an employee, a type, a valid range and counted days", () => {
    expect(canSaveLeave({ ...base, employeeId: "" })).toBe(false);
    expect(canSaveLeave({ ...base, leaveTypeId: "" })).toBe(false);
    expect(canSaveLeave({ ...base, end: "2026-01-10" })).toBe(false);
    expect(canSaveLeave({ ...base, halfValid: false })).toBe(false);
    expect(canSaveLeave({ ...base, days: 0 })).toBe(false);
    expect(canSaveLeave({ ...base, days: null })).toBe(false);
    expect(canSaveLeave({ ...base, saving: true })).toBe(false);
  });
});
