// Spec 1.3: gathers exactly the facts that shared evaluateLeave() needs, recomputes the day
// count with shared workingDays(), and returns the server's authoritative result.
// Runs inside the caller's transaction (after the per-employee advisory lock) for mutations,
// and on the plain connection for the read-only preview.
import {
  balanceAfter,
  evaluateLeave,
  workingDays,
  type ConflictResult,
  type DayCountMode,
  type DayCountResult,
  type HalfDay,
} from "@leave/shared";
import { and, asc, count, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import { toDays } from "../db/days";
import { attachment, companySettings, department, employee, holiday, leaveRequest, leaveType } from "../db/schema";
import { DomainError, notFound } from "./errors";
import { availableForLeave } from "./ledgerService";

type Conn = Db | Tx;

export type LeaveDraft = {
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  startHalf: HalfDay;
  endHalf: HalfDay;
};

export type CheckOptions = {
  context: "operator" | "portal";
  /** The leave being edited, approved or restored: left out of overlap, balance and colleagues. */
  excludeLeaveId?: string | undefined;
  /** Whether the leave has (or will have) an attachment. */
  attachmentPresent: boolean;
};

export type CheckResult = {
  dayCount: DayCountResult;
  balance: { available: number; after: number } | null;
  conflicts: ConflictResult;
  employee: typeof employee.$inferSelect;
  leaveType: typeof leaveType.$inferSelect;
  settings: typeof companySettings.$inferSelect;
};

export async function loadSettings(conn: Conn) {
  const [row] = await conn.select().from(companySettings).where(eq(companySettings.id, 1)).limit(1);
  if (!row) throw new Error("company_settings row missing: run db:seed");
  return row;
}

/** Takes the per-employee lock so two parallel writes cannot both pass overlap/balance checks. */
export async function lockEmployee(tx: Tx, employeeId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${employeeId}))`);
}

/** Does the leave have a live attachment right now? */
export async function hasAttachment(conn: Conn, leaveRequestId: string): Promise<boolean> {
  const [row] = await conn
    .select({ n: count() })
    .from(attachment)
    .where(and(eq(attachment.leaveRequestId, leaveRequestId), isNull(attachment.deletedAt)));
  return (row?.n ?? 0) > 0;
}

/** Holidays (date + half-day flag) between two dates inclusive: the input of shared workingDays(). */
export function loadHolidays(conn: Conn, from: string, to: string) {
  return conn
    .select({ date: holiday.date, isHalfDay: holiday.isHalfDay })
    .from(holiday)
    .where(and(gte(holiday.date, from), lte(holiday.date, to)));
}

/** Rule 1 on the server: shared workingDays() against the CURRENT holiday table. */
export async function dayCountFor(
  conn: Conn,
  span: Pick<LeaveDraft, "startDate" | "endDate" | "startHalf" | "endHalf">,
  opts: { mode: DayCountMode; workDays: number },
): Promise<DayCountResult> {
  const holidays = await loadHolidays(conn, span.startDate, span.endDate);
  return workingDays({
    startDate: span.startDate,
    endDate: span.endDate,
    startHalf: span.startHalf,
    endHalf: span.endHalf,
    mode: opts.mode,
    workDays: opts.workDays,
    holidays,
  });
}

export async function checkLeave(conn: Conn, draft: LeaveDraft, opts: CheckOptions): Promise<CheckResult> {
  const [emp] = await conn.select().from(employee).where(eq(employee.id, draft.employeeId)).limit(1);
  if (!emp) throw notFound();
  const [type] = await conn.select().from(leaveType).where(eq(leaveType.id, draft.leaveTypeId)).limit(1);
  if (!type) throw notFound();
  const settings = await loadSettings(conn);

  const dayCount = await dayCountFor(conn, draft, { mode: type.dayCountMode, workDays: emp.workDaysOverride ?? settings.workDays });

  const notSelf = opts.excludeLeaveId ? ne(leaveRequest.id, opts.excludeLeaveId) : undefined;
  const active = and(isNull(leaveRequest.deletedAt), inArray(leaveRequest.status, ["pending", "approved"]));
  const overlapsRange = and(lte(leaveRequest.startDate, draft.endDate), gte(leaveRequest.endDate, draft.startDate));

  const ownLeaves = await conn
    .select({
      id: leaveRequest.id,
      startDate: leaveRequest.startDate,
      endDate: leaveRequest.endDate,
      startHalf: leaveRequest.startHalf,
      endHalf: leaveRequest.endHalf,
      leaveTypeName: leaveType.name,
    })
    .from(leaveRequest)
    .innerJoin(leaveType, eq(leaveType.id, leaveRequest.leaveTypeId))
    .where(and(eq(leaveRequest.employeeId, emp.id), active, overlapsRange, notSelf));

  const available = type.deductsBalance
    ? await availableForLeave(conn, {
        employeeId: emp.id,
        leaveTypeId: type.id,
        startDate: draft.startDate,
        excludeLeaveId: opts.excludeLeaveId,
      })
    : null;

  const [dept] = await conn.select({ name: department.name }).from(department).where(eq(department.id, emp.departmentId));
  const [size] = await conn
    .select({ n: count() })
    .from(employee)
    .where(and(eq(employee.departmentId, emp.departmentId), eq(employee.status, "active")));
  // Portal: only APPROVED colleague leaves count. Other people's pending requests are invisible
  // to an employee (spec 4.3), even as a number.
  const colleagueLeaves =
    opts.context === "portal"
      ? and(isNull(leaveRequest.deletedAt), eq(leaveRequest.status, "approved"))
      : active;
  const colleaguesOff = await conn
    .select({ name: employee.fullName, startDate: leaveRequest.startDate, endDate: leaveRequest.endDate })
    .from(leaveRequest)
    .innerJoin(employee, eq(employee.id, leaveRequest.employeeId))
    .where(
      and(
        eq(employee.departmentId, emp.departmentId),
        eq(employee.status, "active"),
        ne(employee.id, emp.id),
        colleagueLeaves,
        overlapsRange,
      ),
    )
    .orderBy(asc(leaveRequest.startDate));

  const conflicts = evaluateLeave({
    context: opts.context,
    span: draft,
    days: dayCount.days,
    employment: { hireDate: emp.hireDate, endDate: emp.endDate },
    ownLeaves,
    balance: available === null ? null : { available },
    settings: { allowNegative: settings.allowNegative, negativeLimitDays: toDays(settings.negativeLimitDays) },
    department: { name: dept?.name ?? "", size: size?.n ?? 0, colleaguesOff },
    attachment: { required: type.requiresAttachment, present: opts.attachmentPresent, isSickLeave: type.code === "sick" },
  });

  return {
    dayCount,
    balance: available === null ? null : { available, after: balanceAfter(available, dayCount.days) },
    conflicts,
    employee: emp,
    leaveType: type,
    settings,
  };
}

/** Throws the 422 the drawer shows in its conflict strip when anything is blocking. */
export function assertNotBlocked(conflicts: ConflictResult): void {
  if (conflicts.blocking.length > 0) {
    throw new DomainError("leave.errors.blocked", 422, undefined, { conflicts });
  }
}
