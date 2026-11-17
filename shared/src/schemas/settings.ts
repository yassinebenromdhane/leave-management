// Step 4 payloads: Settings (company, departments, leave types, policies, holidays), the manual
// accrual run and report periods. Messages are i18n keys.
import { z } from "zod";
import { PALETTE_KEYS } from "../palette";
import { ACCRUAL_MODES, DAY_COUNT_MODES, SAVE_STATUSES, TEAM_VISIBILITY } from "../types";
import { isValidWeekMask } from "../weekMask";
import { MONTH_KEY_RE } from "../rules/accrual";
import { daysSchema, isoDateSchema } from "./domain";

const nonEmpty = (v: object) => Object.keys(v).length > 0;
const NOTHING = { message: "errors.nothingToUpdate" };

/** A non-negative day amount in 0.5 steps. */
export const nonNegativeDaysSchema = daysSchema.refine((d) => d >= 0, { message: "errors.nonNegative" });

// ---------- company ----------

/** Locales the exports and emails know: fr or en, optionally with a region (fr-FR, en-GB). */
export const LOCALE_RE = /^(fr|en)(-[A-Z]{2})?$/;

export const companySettingsUpdateSchema = z
  .object({
    name: z.string().trim().min(1, { message: "errors.required" }).max(120),
    countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, { message: "settings.errors.countryCode" }),
    workDays: z.number().int().refine(isValidWeekMask, { message: "settings.errors.workDays" }),
    leaveYearStartMonth: z.number().int().min(1).max(12),
    allowNegative: z.boolean(),
    negativeLimitDays: nonNegativeDaysSchema,
    defaultSaveStatus: z.enum(SAVE_STATUSES),
    locale: z.string().regex(LOCALE_RE, { message: "settings.errors.locale" }),
    teamVisibility: z.enum(TEAM_VISIBILITY),
  })
  .partial()
  .refine(nonEmpty, NOTHING);
export type CompanySettingsUpdateInput = z.infer<typeof companySettingsUpdateSchema>;

// ---------- departments ----------

export const departmentUpdateSchema = z
  .object({
    name: z.string().trim().min(1, { message: "errors.required" }).max(80),
    minStaffing: z.number().int().min(0).max(500).nullable(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .partial()
  .refine(nonEmpty, NOTHING);
export type DepartmentUpdateInput = z.infer<typeof departmentUpdateSchema>;

// ---------- leave types ----------

const leaveTypeFields = {
  name: z.string().trim().min(1, { message: "errors.required" }).max(80),
  color: z.enum(PALETTE_KEYS),
  isPaid: z.boolean(),
  deductsBalance: z.boolean(),
  dayCountMode: z.enum(DAY_COUNT_MODES),
  requiresAttachment: z.boolean(),
  annualCapDays: nonNegativeDaysSchema.nullable(),
  defaultSaveStatus: z.enum(SAVE_STATUSES).nullable(), // null = company default
  sortOrder: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
};

export const leaveTypeCreateSchema = z.object({
  name: leaveTypeFields.name,
  color: leaveTypeFields.color,
  isPaid: leaveTypeFields.isPaid.default(true),
  deductsBalance: leaveTypeFields.deductsBalance.default(true),
  dayCountMode: leaveTypeFields.dayCountMode.default("working"),
  requiresAttachment: leaveTypeFields.requiresAttachment.default(false),
  annualCapDays: leaveTypeFields.annualCapDays.default(null),
  defaultSaveStatus: leaveTypeFields.defaultSaveStatus.default(null),
  sortOrder: leaveTypeFields.sortOrder.optional(),
  isActive: leaveTypeFields.isActive.default(true),
});
export type LeaveTypeCreateInput = z.input<typeof leaveTypeCreateSchema>;

/** Never deletes: deactivate with `isActive: false`. Past ledger entries are never rewritten. */
export const leaveTypeUpdateSchema = z.object(leaveTypeFields).partial().refine(nonEmpty, NOTHING);
export type LeaveTypeUpdateInput = z.infer<typeof leaveTypeUpdateSchema>;

// ---------- policies ----------

/** Spec 1.5: every rule change asks whether it applies from today or from the leave-year start. */
export const POLICY_APPLY_FROM = ["today", "leaveYearStart"] as const;
export type PolicyApplyFrom = (typeof POLICY_APPLY_FROM)[number];

export const leavePolicyInputSchema = z.object({
  accrualMode: z.enum(ACCRUAL_MODES),
  rateDays: nonNegativeDaysSchema,
  prorateHireMonth: z.boolean().default(true),
  carryoverCapDays: nonNegativeDaysSchema.nullish().transform((v) => v ?? null),
  carryoverExpiryMonthDay: z
    .string()
    .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/, { message: "settings.errors.monthDay" })
    .nullish()
    .transform((v) => v ?? null),
  applyFrom: z.enum(POLICY_APPLY_FROM),
});
export type LeavePolicyInput = z.input<typeof leavePolicyInputSchema>;

// ---------- holidays ----------

/** Operator-added holidays are custom days or company closures; presets come from the seed. */
export const OPERATOR_HOLIDAY_SOURCES = ["custom", "closure"] as const;

export const holidayCreateSchema = z.object({
  date: isoDateSchema,
  name: z.string().trim().min(1, { message: "errors.required" }).max(120),
  isHalfDay: z.boolean().default(false),
  isConfirmed: z.boolean().default(true),
  source: z.enum(OPERATOR_HOLIDAY_SOURCES).default("custom"),
});
export type HolidayCreateInput = z.input<typeof holidayCreateSchema>;

export const holidayUpdateSchema = z
  .object({
    date: isoDateSchema,
    name: z.string().trim().min(1, { message: "errors.required" }).max(120),
    isHalfDay: z.boolean(),
    isConfirmed: z.boolean(),
  })
  .partial()
  .refine(nonEmpty, NOTHING);
export type HolidayUpdateInput = z.infer<typeof holidayUpdateSchema>;

/** Rule 8 confirm step: recalculate the listed leaves against the current holiday set. */
export const holidayRecalculateSchema = z.object({
  leaveIds: z.array(z.string().uuid()).min(1).max(500),
});
export type HolidayRecalculateInput = z.infer<typeof holidayRecalculateSchema>;

/** `?year=2026` (defaults to the current year on the server). */
export const yearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type YearQuery = z.input<typeof yearQuerySchema>;

// ---------- accrual ----------

export const accrualPeriodSchema = z.object({
  period: z.string().regex(MONTH_KEY_RE, { message: "accrual.errors.period" }),
});
export type AccrualPeriodInput = z.infer<typeof accrualPeriodSchema>;

// ---------- reports ----------

/** The caller derives from/to from month, quarter, year or a custom range. Max span is checked on the server (422). */
export const reportPeriodQuerySchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((v) => v.from <= v.to, { path: ["to"], message: "reports.errors.endBeforeStart" });
export type ReportPeriodQuery = z.infer<typeof reportPeriodQuerySchema>;

export const EXPORT_FORMATS = ["xlsx", "csv"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const reportExportQuerySchema = z
  .object({ from: isoDateSchema, to: isoDateSchema, format: z.enum(EXPORT_FORMATS) })
  .refine((v) => v.from <= v.to, { path: ["to"], message: "reports.errors.endBeforeStart" });
export type ReportExportQuery = z.infer<typeof reportExportQuerySchema>;
