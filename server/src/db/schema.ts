// MVP data model (spec 4.1). Column names are camelCase here and snake_case in PostgreSQL
// (casing: "snake_case" in drizzle.config.ts and client.ts).
//
// Invariants encoded here:
// - No balance column anywhere: balances are SUM(ledger_entry.days) (invariant 1).
// - ledger_entry is append-only and unique on (employee, type, entry_type, period_key) (invariant 2).
// - Day amounts are numeric(6,1) in 0.5 steps (invariant 7).
// - History is never cascaded away: FKs into requests and ledger use ON DELETE RESTRICT.
//
// Auth tables (Better Auth user/session/account/verification) replace the spec's portal_account;
// see the end of this file. period_lock is V2.

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  ACCRUAL_MODES,
  DAY_COUNT_MODES,
  EMPLOYEE_STATUSES,
  ENTRY_TYPES,
  HALF_DAYS,
  HOLIDAY_SOURCES,
  LEAVE_STATUSES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KINDS,
  NOTIFICATION_RECIPIENTS,
  PALETTE_KEYS,
  REQUEST_SOURCES,
  SAVE_STATUSES,
  TEAM_VISIBILITY,
  USER_ROLES,
} from "@leave/shared";

// ---------- enums (built from @leave/shared) ----------

export const leaveStatusEnum = pgEnum("leave_status", LEAVE_STATUSES);
export const saveStatusEnum = pgEnum("save_status", SAVE_STATUSES);
export const entryTypeEnum = pgEnum("entry_type", ENTRY_TYPES);
export const halfDayEnum = pgEnum("half_day", HALF_DAYS);
export const requestSourceEnum = pgEnum("request_source", REQUEST_SOURCES);
export const dayCountModeEnum = pgEnum("day_count_mode", DAY_COUNT_MODES);
export const employeeStatusEnum = pgEnum("employee_status", EMPLOYEE_STATUSES);
export const accrualModeEnum = pgEnum("accrual_mode", ACCRUAL_MODES);
export const holidaySourceEnum = pgEnum("holiday_source", HOLIDAY_SOURCES);
export const notificationRecipientEnum = pgEnum("notification_recipient", NOTIFICATION_RECIPIENTS);
export const notificationKindEnum = pgEnum("notification_kind", NOTIFICATION_KINDS);
export const notificationChannelEnum = pgEnum("notification_channel", NOTIFICATION_CHANNELS);
export const teamVisibilityEnum = pgEnum("team_visibility", TEAM_VISIBILITY);
export const paletteColorEnum = pgEnum("palette_color", PALETTE_KEYS);
export const userRoleEnum = pgEnum("user_role", USER_ROLES);

// ---------- helpers ----------

const days = () => numeric({ precision: 6, scale: 1 });
const isoDate = () => date({ mode: "string" });
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------- company_settings (single row) ----------

export const companySettings = pgTable(
  "company_settings",
  {
    id: smallint().primaryKey().default(1),
    name: text().notNull().default(""),
    logoStorageKey: text(),
    countryCode: text().notNull().default("XX"), // TODO(spec-open-question): first country preset
    workDays: smallint().notNull().default(31), // bit 0 = Mon … bit 6 = Sun; 31 = Mon–Fri
    leaveYearStartMonth: smallint().notNull().default(1),
    allowNegative: boolean().notNull().default(false),
    negativeLimitDays: days().notNull().default("0"),
    defaultSaveStatus: saveStatusEnum().notNull().default("approved"),
    locale: text().notNull().default("fr-FR"),
    teamVisibility: teamVisibilityEnum().notNull().default("department"),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("company_settings_singleton", sql`${t.id} = 1`),
    check("company_settings_work_days_range", sql`${t.workDays} between 1 and 127`),
    check("company_settings_year_start_month", sql`${t.leaveYearStartMonth} between 1 and 12`),
    check("company_settings_negative_limit", sql`${t.negativeLimitDays} >= 0`),
  ],
);

// ---------- department ----------

export const department = pgTable(
  "department",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    minStaffing: smallint(), // V2 check, column ready
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("department_name_unique").on(t.name)],
);

// ---------- employee ----------

export const employee = pgTable(
  "employee",
  {
    id: uuid().primaryKey().defaultRandom(),
    fullName: text().notNull(),
    employeeCode: text(),
    departmentId: uuid()
      .notNull()
      .references(() => department.id, { onDelete: "restrict" }),
    jobTitle: text(),
    email: text(),
    portalAccess: boolean().notNull().default(false),
    hireDate: isoDate().notNull(),
    endDate: isoDate(),
    workDaysOverride: smallint(), // null = company pattern
    annualAllowanceOverride: days(),
    status: employeeStatusEnum().notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("employee_code_unique").on(t.employeeCode),
    uniqueIndex("employee_email_unique").on(sql`lower(${t.email})`),
    index("employee_department_idx").on(t.departmentId),
    check("employee_end_after_hire", sql`${t.endDate} is null or ${t.endDate} >= ${t.hireDate}`),
    check(
      "employee_work_days_override_range",
      sql`${t.workDaysOverride} is null or ${t.workDaysOverride} between 1 and 127`,
    ),
  ],
);

// ---------- leave_type ----------

export const leaveType = pgTable(
  "leave_type",
  {
    id: uuid().primaryKey().defaultRandom(),
    code: text(), // stable key for seeded presets (paid, sick, …); null for custom types
    name: text().notNull(),
    color: paletteColorEnum().notNull(),
    isPaid: boolean().notNull().default(true),
    deductsBalance: boolean().notNull().default(true),
    dayCountMode: dayCountModeEnum().notNull().default("working"),
    requiresAttachment: boolean().notNull().default(false),
    annualCapDays: days(),
    defaultSaveStatus: saveStatusEnum(), // null = company default
    sortOrder: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("leave_type_code_unique").on(t.code)],
);

// ---------- leave_policy (new row per rule change) ----------

export const leavePolicy = pgTable(
  "leave_policy",
  {
    id: uuid().primaryKey().defaultRandom(),
    leaveTypeId: uuid()
      .notNull()
      .references(() => leaveType.id, { onDelete: "restrict" }),
    accrualMode: accrualModeEnum().notNull(),
    rateDays: days().notNull(), // per month (monthly) or per leave year (annual)
    prorateHireMonth: boolean().notNull().default(true),
    carryoverCapDays: days(),
    carryoverExpiryMonthDay: text(), // "MM-DD"
    effectiveFrom: isoDate().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("leave_policy_type_effective_unique").on(t.leaveTypeId, t.effectiveFrom),
    check(
      "leave_policy_expiry_format",
      sql`${t.carryoverExpiryMonthDay} is null or ${t.carryoverExpiryMonthDay} ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'`,
    ),
  ],
);

// ---------- leave_request ----------

export const leaveRequest = pgTable(
  "leave_request",
  {
    id: uuid().primaryKey().defaultRandom(),
    employeeId: uuid()
      .notNull()
      .references(() => employee.id, { onDelete: "restrict" }),
    leaveTypeId: uuid()
      .notNull()
      .references(() => leaveType.id, { onDelete: "restrict" }),
    startDate: isoDate().notNull(),
    endDate: isoDate().notNull(),
    startHalf: halfDayEnum().notNull().default("full"),
    endHalf: halfDayEnum().notNull().default("full"),
    workingDays: days().notNull(), // snapshot computed by the server at save time
    status: leaveStatusEnum().notNull(),
    note: text(),
    rejectReason: text(),
    hasWarning: boolean().notNull().default(false),
    conflictResult: jsonb().$type<unknown>(), // spec 1.7: conflict check result attached at submit
    source: requestSourceEnum().notNull(),
    hrChangedAt: timestamp({ withTimezone: true }), // drives the portal's "changed by HR" note
    // Set when the EMPLOYEE withdraws a pending request from the portal. A withdrawn request is
    // final: the operator can no longer approve or reject it (spec 4.3 sync rule 6).
    withdrawnAt: timestamp({ withTimezone: true }),
    submittedAt: timestamp({ withTimezone: true }),
    decidedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check("leave_request_end_after_start", sql`${t.endDate} >= ${t.startDate}`),
    check("leave_request_working_days_step", sql`mod(${t.workingDays} * 10, 5) = 0 and ${t.workingDays} > 0`),
    index("leave_request_employee_dates_idx")
      .on(t.employeeId, t.startDate, t.endDate)
      .where(sql`deleted_at is null`),
    index("leave_request_status_idx").on(t.status).where(sql`deleted_at is null`),
    index("leave_request_dates_idx").on(t.startDate, t.endDate).where(sql`deleted_at is null`),
  ],
);

// ---------- ledger_entry (append-only) ----------

export const ledgerEntry = pgTable(
  "ledger_entry",
  {
    id: uuid().primaryKey().defaultRandom(),
    employeeId: uuid()
      .notNull()
      .references(() => employee.id, { onDelete: "restrict" }),
    leaveTypeId: uuid()
      .notNull()
      .references(() => leaveType.id, { onDelete: "restrict" }),
    entryType: entryTypeEnum().notNull(),
    days: days().notNull(), // signed
    effectiveDate: isoDate().notNull(),
    leaveRequestId: uuid().references(() => leaveRequest.id, { onDelete: "restrict" }),
    periodKey: text(), // "YYYY-MM" for accrual, leave-year label for carryover/expiry
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [
    // NULL period_key values are distinct in PostgreSQL, so leave/reversal rows never collide,
    // while accrual and year-end runs stay idempotent.
    uniqueIndex("ledger_entry_idempotency_unique").on(t.employeeId, t.leaveTypeId, t.entryType, t.periodKey),
    index("ledger_entry_balance_idx").on(t.employeeId, t.leaveTypeId, t.effectiveDate),
    index("ledger_entry_request_idx").on(t.leaveRequestId),
    check("ledger_entry_days_step", sql`mod(${t.days} * 10, 5) = 0`),
  ],
);

// ---------- holiday ----------

export const holiday = pgTable(
  "holiday",
  {
    id: uuid().primaryKey().defaultRandom(),
    date: isoDate().notNull(),
    name: text().notNull(),
    isHalfDay: boolean().notNull().default(false),
    isConfirmed: boolean().notNull().default(true), // false = movable holiday, "date to confirm"
    source: holidaySourceEnum().notNull().default("preset"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("holiday_date_unique").on(t.date)],
);

// ---------- attachment ----------

export const attachment = pgTable(
  "attachment",
  {
    id: uuid().primaryKey().defaultRandom(),
    leaveRequestId: uuid()
      .notNull()
      .references(() => leaveRequest.id, { onDelete: "restrict" }),
    fileName: text().notNull(),
    mimeType: text().notNull(),
    sizeBytes: integer().notNull(),
    storageKey: text().notNull(),
    uploadedAt: createdAt(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("attachment_storage_key_unique").on(t.storageKey),
    index("attachment_request_idx").on(t.leaveRequestId),
    check("attachment_size_limit", sql`${t.sizeBytes} > 0 and ${t.sizeBytes} <= 10485760`),
  ],
);

// ---------- audit_log ----------

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    entity: text().notNull(),
    entityId: text().notNull(),
    action: text().notNull(),
    actor: text(), // auth user id (step 2) or "system"
    beforeJson: jsonb().$type<unknown>(),
    afterJson: jsonb().$type<unknown>(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId)],
);

// ---------- notification ----------

export const notification = pgTable(
  "notification",
  {
    id: uuid().primaryKey().defaultRandom(),
    recipient: notificationRecipientEnum().notNull(),
    recipientEmployeeId: uuid().references(() => employee.id, { onDelete: "restrict" }),
    leaveRequestId: uuid().references(() => leaveRequest.id, { onDelete: "restrict" }),
    kind: notificationKindEnum().notNull(),
    channel: notificationChannelEnum().notNull(),
    sentAt: timestamp({ withTimezone: true }),
    readAt: timestamp({ withTimezone: true }),
    error: text(), // email delivery failure; never rolls back the business change
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "notification_recipient_consistency",
      sql`(${t.recipient} = 'employee') = (${t.recipientEmployeeId} is not null)`,
    ),
    index("notification_unread_idx").on(t.recipient, t.recipientEmployeeId).where(sql`read_at is null`),
  ],
);

// ---------- auth (Better Auth core tables, replacing spec's portal_account) ----------
// Property names must match Better Auth's field names (the Drizzle adapter maps by key).
// Spec 2.5 fields live on `user` as Better Auth additionalFields (input: false, so clients
// can never set them): role, employeeId, mustChangePassword, failedAttempts, lockedUntil.
// Passwords are Argon2id hashes on `account.password`; reset and invite tokens are stored
// hashed in `verification.identifier` (verification.storeIdentifier = "hashed").

export const user = pgTable(
  "user",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    email: text().notNull(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    role: userRoleEnum().notNull().default("employee"),
    employeeId: uuid().references(() => employee.id, { onDelete: "restrict" }),
    mustChangePassword: boolean().notNull().default(false),
    failedAttempts: integer().notNull().default(0),
    lockedUntil: timestamp({ withTimezone: true }),
    lastLoginAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("user_email_unique").on(t.email),
    uniqueIndex("user_employee_unique").on(t.employeeId),
    check("user_role_employee_link", sql`(${t.role} = 'employee') = (${t.employeeId} is not null)`),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text().primaryKey(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    token: text().notNull(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("session_token_unique").on(t.token), index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);
