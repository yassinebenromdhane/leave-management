// Shared enumerations. These `as const` arrays are the single source for:
// - Zod schemas (z.enum(ARRAY))
// - Drizzle pgEnum definitions in server/src/db/schema.ts
// - UI pickers and i18n keys in web/
// Change an array here first, then run /add-migration.

export const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

/** Statuses an operator may choose as the default on save (spec 1.2). */
export const SAVE_STATUSES = ["pending", "approved"] as const;
export type SaveStatus = (typeof SAVE_STATUSES)[number];

export const ENTRY_TYPES = [
  "opening",
  "accrual",
  "leave",
  "adjustment",
  "carryover",
  "expiry",
  "reversal",
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const HALF_DAYS = ["full", "am", "pm"] as const;
export type HalfDay = (typeof HALF_DAYS)[number];

export const REQUEST_SOURCES = ["operator", "portal"] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];

export const DAY_COUNT_MODES = ["working", "calendar"] as const;
export type DayCountMode = (typeof DAY_COUNT_MODES)[number];

export const EMPLOYEE_STATUSES = ["active", "archived"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const ACCRUAL_MODES = ["annual", "monthly"] as const;
export type AccrualMode = (typeof ACCRUAL_MODES)[number];

export const HOLIDAY_SOURCES = ["preset", "custom", "closure"] as const;
export type HolidaySource = (typeof HOLIDAY_SOURCES)[number];

export const NOTIFICATION_RECIPIENTS = ["operator", "employee"] as const;
export type NotificationRecipient = (typeof NOTIFICATION_RECIPIENTS)[number];

export const NOTIFICATION_KINDS = ["submitted", "approved", "rejected", "withdrawn", "changed"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_CHANNELS = ["in_app", "email"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Who teammates' "Away" data is shown to in the portal (spec 1.7). */
export const TEAM_VISIBILITY = ["department", "company", "off"] as const;
export type TeamVisibility = (typeof TEAM_VISIBILITY)[number];

export const USER_ROLES = ["operator", "employee"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const LEAVE_EVENTS = ["leave.submitted", "leave.decided", "leave.changed", "leave.withdrawn"] as const;
export type LeaveEventType = (typeof LEAVE_EVENTS)[number];

/** Calendar date as ISO `YYYY-MM-DD`. Never a JS Date at local midnight. */
export type IsoDate = string;
