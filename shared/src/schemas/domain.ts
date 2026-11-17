// Step 3 payloads: departments, employees, leave requests, ledger adjustments.
// One schema per payload, used by the React forms, @hono/zod-validator and the typed client.
// Messages are i18n keys.
import { z } from "zod";
import { HALF_DAYS, LEAVE_STATUSES, SAVE_STATUSES } from "../types";
import { daysBetween, isValidIsoDate } from "../rules/dates";
import { isHalfStep } from "../rules/halfDays";
import { isValidHalfCombination } from "../rules/workingDays";

export const isoDateSchema = z.string().refine(isValidIsoDate, { message: "errors.invalidDate" });

/** A day amount: multiple of 0.5. */
export const daysSchema = z.number().finite().refine(isHalfStep, { message: "errors.halfDayStep" });

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

// ---------- departments ----------

export const departmentInputSchema = z.object({
  name: z.string().trim().min(1, { message: "errors.required" }).max(80),
  minStaffing: z.number().int().min(0).max(500).nullish(),
});
export type DepartmentInput = z.infer<typeof departmentInputSchema>;

// ---------- employees ----------

export const openingBalanceSchema = z.object({ leaveTypeId: z.string().uuid(), days: daysSchema });

/** Quick add needs only name, department and hire date (spec 1.1). */
export const employeeCreateSchema = z
  .object({
    fullName: z.string().trim().min(1, { message: "errors.required" }).max(120),
    departmentId: z.string().uuid({ message: "errors.required" }),
    hireDate: isoDateSchema,
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email({ message: "auth.errors.emailInvalid" })
      .max(254)
      .nullish()
      .or(z.literal("").transform(() => null)),
    employeeCode: optionalText(40),
    jobTitle: optionalText(120),
    endDate: isoDateSchema.nullish(),
    annualAllowanceOverride: daysSchema.nullish(),
    openingBalances: z.array(openingBalanceSchema).max(20).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.endDate && v.endDate < v.hireDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "employees.errors.endBeforeHire" });
    }
  });
export type EmployeeCreateInput = z.input<typeof employeeCreateSchema>;

/** Inline edit: any subset of the editable fields. */
export const employeeUpdateSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120),
    departmentId: z.string().uuid(),
    hireDate: isoDateSchema,
    email: z.string().trim().toLowerCase().email({ message: "auth.errors.emailInvalid" }).max(254).nullable(),
    employeeCode: z.string().trim().max(40).nullable(),
    jobTitle: z.string().trim().max(120).nullable(),
    endDate: isoDateSchema.nullable(),
    annualAllowanceOverride: daysSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "errors.nothingToUpdate" });
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;

/** Manual adjustment (spec 1.1): ± days, type, effective date, mandatory note. */
export const adjustmentSchema = z.object({
  leaveTypeId: z.string().uuid(),
  days: daysSchema.refine((d) => d !== 0, { message: "ledger.errors.zeroAdjustment" }),
  effectiveDate: isoDateSchema,
  note: z.string().trim().min(1, { message: "ledger.errors.noteRequired" }).max(500),
});
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

// ---------- leave requests ----------

export const leaveSpanShape = {
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  startHalf: z.enum(HALF_DAYS).default("full"),
  endHalf: z.enum(HALF_DAYS).default("full"),
};

/** Longest leave accepted anywhere (one year, leap year included). */
export const MAX_LEAVE_SPAN_DAYS = 366;

export const checkSpan = (
  v: { startDate?: string; endDate?: string; startHalf?: string; endHalf?: string },
  ctx: z.RefinementCtx,
) => {
  if (!v.startDate || !v.endDate) return;
  if (v.endDate < v.startDate) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "leave.errors.endBeforeStart" });
    return;
  }
  // Bounds the day-by-day rules (and the cost of every preview) — security audit, step 5.
  if (isValidIsoDate(v.startDate) && isValidIsoDate(v.endDate) && daysBetween(v.startDate, v.endDate) + 1 > MAX_LEAVE_SPAN_DAYS) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "leave.errors.tooLong" });
    return;
  }
  const span = {
    startDate: v.startDate,
    endDate: v.endDate,
    startHalf: (v.startHalf ?? "full") as "full",
    endHalf: (v.endHalf ?? "full") as "full",
  };
  if (!isValidHalfCombination(span)) {
    ctx.addIssue({ code: "custom", path: ["endHalf"], message: "leave.errors.invalidHalfDays" });
  }
};

/** Operator create (spec 1.2). Status defaults to the company/type default when omitted. */
export const leaveCreateSchema = z
  .object({
    employeeId: z.string().uuid({ message: "errors.required" }),
    leaveTypeId: z.string().uuid({ message: "errors.required" }),
    ...leaveSpanShape,
    note: optionalText(1000),
    status: z.enum(SAVE_STATUSES).optional(),
  })
  .superRefine(checkSpan);
export type LeaveCreateInput = z.input<typeof leaveCreateSchema>;

/** Operator edit of dates, halves, type or note. */
export const leaveUpdateSchema = z
  .object({
    leaveTypeId: z.string().uuid(),
    ...leaveSpanShape,
    note: optionalText(1000),
  })
  .superRefine(checkSpan);
export type LeaveUpdateInput = z.input<typeof leaveUpdateSchema>;

/** Status change by pill click or A / R (spec 1.2 status model). */
export const leaveStatusChangeSchema = z.object({
  status: z.enum(LEAVE_STATUSES),
  reason: optionalText(500),
});
export type LeaveStatusChangeInput = z.infer<typeof leaveStatusChangeSchema>;

/** Live preview request: the drawer asks the server for facts it cannot compute alone. */
export const leavePreviewSchema = z
  .object({
    employeeId: z.string().uuid(),
    leaveTypeId: z.string().uuid(),
    ...leaveSpanShape,
    excludeLeaveId: z.string().uuid().optional(),
    hasAttachment: z.boolean().default(false),
  })
  .superRefine(checkSpan);
export type LeavePreviewInput = z.input<typeof leavePreviewSchema>;

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;

// ---------- query strings and bulk actions (step 3 operator API) ----------

/** GET /operator/reference: holidays are limited to [from, to] when given. */
export const referenceQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type ReferenceQuery = z.infer<typeof referenceQuerySchema>;

export const employeeListQuerySchema = z.object({
  status: z.enum(["active", "archived", "all"]).default("active"),
});
export type EmployeeListQuery = z.input<typeof employeeListQuerySchema>;

/** GET /operator/leaves: non-deleted leaves overlapping [from, to]; every filter is optional. */
export const leaveListQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  status: z.enum(LEAVE_STATUSES).optional(),
  departmentId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  leaveTypeId: z.string().uuid().optional(),
});
export type LeaveListQuery = z.input<typeof leaveListQuerySchema>;

/** Bulk approve from the list view (spec 1.2). Each id is processed in its own transaction. */
export const leaveBulkStatusSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  status: z.literal("approved"),
});
export type LeaveBulkStatusInput = z.infer<typeof leaveBulkStatusSchema>;
