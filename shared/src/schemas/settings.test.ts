import { describe, expect, it } from "vitest";
import {
  accrualPeriodSchema,
  companySettingsUpdateSchema,
  holidayCreateSchema,
  leavePolicyInputSchema,
  reportExportQuerySchema,
} from "./settings";

describe("settings schemas", () => {
  it.each([
    [{ workDays: 31 }, true],
    [{ workDays: 0 }, false],
    [{ workDays: 128 }, false],
    [{ leaveYearStartMonth: 12 }, true],
    [{ leaveYearStartMonth: 0 }, false],
    [{ negativeLimitDays: 2.5 }, true],
    [{ negativeLimitDays: 0.3 }, false],
    [{ negativeLimitDays: -0.5 }, false],
    [{ locale: "fr-FR" }, true],
    [{ locale: "de-DE" }, false],
    [{}, false],
  ])("company %j → %s", (input, ok) => {
    expect(companySettingsUpdateSchema.safeParse(input).success).toBe(ok);
  });

  it("policy defaults and MM-DD check", () => {
    expect(leavePolicyInputSchema.parse({ accrualMode: "monthly", rateDays: 2, applyFrom: "today" })).toMatchObject({
      prorateHireMonth: true,
      carryoverCapDays: null,
      carryoverExpiryMonthDay: null,
    });
    expect(
      leavePolicyInputSchema.safeParse({ accrualMode: "annual", rateDays: 25, applyFrom: "leaveYearStart", carryoverExpiryMonthDay: "02-30" })
        .success,
    ).toBe(true);
    expect(leavePolicyInputSchema.safeParse({ accrualMode: "annual", rateDays: 25, applyFrom: "x" }).success).toBe(false);
  });

  it("holiday source is custom or closure only", () => {
    expect(holidayCreateSchema.parse({ date: "2026-12-25", name: "X" }).source).toBe("custom");
    expect(holidayCreateSchema.safeParse({ date: "2026-12-25", name: "X", source: "preset" }).success).toBe(false);
  });

  it("accrual period is YYYY-MM; report periods need from <= to", () => {
    expect(accrualPeriodSchema.safeParse({ period: "2026-11" }).success).toBe(true);
    expect(accrualPeriodSchema.safeParse({ period: "2026-13" }).success).toBe(false);
    expect(reportExportQuerySchema.safeParse({ from: "2026-02-01", to: "2026-01-01", format: "csv" }).success).toBe(false);
    expect(reportExportQuerySchema.safeParse({ from: "2026-01-01", to: "2026-01-31", format: "pdf" }).success).toBe(false);
  });
});
