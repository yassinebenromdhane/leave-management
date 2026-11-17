// Employee portal payloads (spec 1.7, 4.3). Portal INPUT schemas never carry an employeeId: the
// server takes it from the session. They are `.strict()`, so a client that sends one anyway gets
// a 400 instead of having the key silently ignored.
// Response schemas that carry teammate data are `.strict()` too: parsing a response proves that
// nothing beyond the "Away" projection left the server.
import { z } from "zod";
import { HALF_DAYS, LEAVE_STATUSES, REQUEST_SOURCES, TEAM_VISIBILITY } from "../types";
import { daysBetween } from "../rules/dates";
import { checkSpan, isoDateSchema, leaveSpanShape, optionalText } from "./domain";

/** i18n keys of the portal-specific API errors. */
export const PORTAL_ERRORS = {
  /** Negative balance is allowed but the employee has not ticked "I understand". */
  acknowledgeNegative: "portal.errors.acknowledgeNegative",
  /** Withdraw lost the race: the operator decided first (spec 4.3 sync rule 6). */
  alreadyDecided: "portal.errors.alreadyDecided",
  /** Attachment removal on a leave that is no longer pending. */
  notPending: "portal.errors.notPending",
  /** The leave type is inactive. */
  typeInactive: "leave.errors.typeInactive",
  /** /me/team range longer than PORTAL_TEAM_MAX_DAYS. */
  rangeTooLong: "portal.errors.rangeTooLong",
} as const;

/** Longest window the Team view may ask for in one call. */
export const PORTAL_TEAM_MAX_DAYS = 31;

// ---------- inputs ----------

/**
 * POST /me/leaves (multipart field `data`, JSON). The day count is recomputed on the server.
 * `acknowledgeNegative` must be true when the request would take an allowed negative balance.
 */
export const portalLeaveSubmitSchema = z
  .object({
    leaveTypeId: z.string().uuid({ message: "errors.required" }),
    ...leaveSpanShape,
    note: optionalText(1000),
    acknowledgeNegative: z.boolean().default(false),
  })
  .strict()
  .superRefine(checkSpan);
export type PortalLeaveSubmitInput = z.input<typeof portalLeaveSubmitSchema>;

/** POST /me/leaves/preview: live day count, balance after, conflicts and the Away strip. */
export const portalPreviewSchema = z
  .object({
    leaveTypeId: z.string().uuid({ message: "errors.required" }),
    ...leaveSpanShape,
    hasAttachment: z.boolean().default(false),
  })
  .strict()
  .superRefine(checkSpan);
export type PortalPreviewInput = z.input<typeof portalPreviewSchema>;

/** GET /me/reference?from&to (holidays limited to the range when given). */
export const portalReferenceQuerySchema = z
  .object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() })
  .strict();

/** GET /me/team?from&to: both required, at most 31 days. */
export const portalTeamQuerySchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .strict()
  .superRefine((v, ctx) => {
    if (v.to < v.from) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "leave.errors.endBeforeStart" });
    } else if (daysBetween(v.from, v.to) + 1 > PORTAL_TEAM_MAX_DAYS) {
      ctx.addIssue({ code: "custom", path: ["to"], message: PORTAL_ERRORS.rangeTooLong });
    }
  });
export type PortalTeamQuery = z.infer<typeof portalTeamQuerySchema>;

// ---------- responses ----------

/** One teammate away: exactly these six keys, never type, note, status or attachments. */
export const awayEntrySchema = z
  .object({
    employeeId: z.string().uuid(),
    fullName: z.string(),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    startHalf: z.enum(HALF_DAYS),
    endHalf: z.enum(HALF_DAYS),
  })
  .strict();
export type AwayEntry = z.infer<typeof awayEntrySchema>;

export const portalTeamResponseSchema = z
  .object({ scope: z.enum(TEAM_VISIBILITY), people: z.array(awayEntrySchema) })
  .strict();
export type PortalTeamResponse = z.infer<typeof portalTeamResponseSchema>;

/** A row of GET /me/leaves (also returned by submit). Own data only. */
export const portalLeaveRowSchema = z
  .object({
    id: z.string().uuid(),
    leaveTypeId: z.string().uuid(),
    leaveTypeName: z.string(),
    color: z.string(),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    startHalf: z.enum(HALF_DAYS),
    endHalf: z.enum(HALF_DAYS),
    workingDays: z.number(),
    status: z.enum(LEAVE_STATUSES),
    rejectReason: z.string().nullable(),
    note: z.string().nullable(),
    source: z.enum(REQUEST_SOURCES),
    addedByHr: z.boolean(),
    changedByHr: z.boolean(),
    submittedAt: z.string().nullable(),
    decidedAt: z.string().nullable(),
    attachmentCount: z.number().int(),
  })
  .strict();
export type PortalLeaveRow = z.infer<typeof portalLeaveRowSchema>;
