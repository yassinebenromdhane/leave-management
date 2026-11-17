// Employee portal (spec 1.7, 4.3). Same tables as the operator, narrower API.
// EVERY function takes a PortalScope built from the session (routes/portal/scope.ts) and filters
// by scope.employeeId. No function here accepts an employee id from the client.
import {
  PORTAL_ERRORS,
  PORTAL_TEAM_MAX_DAYS,
  addIsoDays,
  portalConflictsView,
  portalSubmitVerdict,
  withRunningBalance,
  type AwayEntry,
  type ConflictResult,
  type PortalTeamQuery,
  type PortalTeamResponse,
  type portalLeaveSubmitSchema,
  type portalPreviewSchema,
  type portalReferenceQuerySchema,
} from "@leave/shared";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { db, type Db, type Tx } from "../db/client";
import { fromDays, toDays } from "../db/days";
import {
  attachment,
  department,
  employee,
  holiday,
  leavePolicy,
  leaveRequest,
  leaveType,
  ledgerEntry,
  notification,
} from "../db/schema";
import { publishLeaveEvent } from "../realtime/bus";
import { checkUpload, insertAttachment, softDeleteAttachment, withStoredFile } from "./attachmentService";
import { writeAudit } from "./audit";
import { checkLeave, loadSettings, lockEmployee } from "./conflictChecker";
import { DomainError, notFound } from "./errors";
import { loadBalances } from "./ledgerService";
import { notifyOperator } from "./notificationService";
import { todayIso } from "./today";

type Conn = Db | Tx;

/** Who is asking: both ids come from the session, never from the request. */
export type PortalScope = { employeeId: string; userId: string };

const iso = (d: Date | null) => (d ? d.toISOString() : null);

// ---------- own leaves (row shape shared by /me/leaves, dashboard and submit) ----------

const attachmentCount = sql<number>`(
  select count(*)::int from ${attachment}
  where ${attachment.leaveRequestId} = ${leaveRequest.id} and ${attachment.deletedAt} is null
)`;

function selectOwnLeaves(conn: Conn, scope: PortalScope, where?: SQL) {
  return conn
    .select({
      id: leaveRequest.id,
      leaveTypeId: leaveRequest.leaveTypeId,
      leaveTypeName: leaveType.name,
      color: leaveType.color,
      startDate: leaveRequest.startDate,
      endDate: leaveRequest.endDate,
      startHalf: leaveRequest.startHalf,
      endHalf: leaveRequest.endHalf,
      workingDays: leaveRequest.workingDays,
      status: leaveRequest.status,
      rejectReason: leaveRequest.rejectReason,
      note: leaveRequest.note,
      source: leaveRequest.source,
      hrChangedAt: leaveRequest.hrChangedAt,
      submittedAt: leaveRequest.submittedAt,
      decidedAt: leaveRequest.decidedAt,
      attachmentCount,
    })
    .from(leaveRequest)
    .innerJoin(leaveType, eq(leaveType.id, leaveRequest.leaveTypeId))
    .where(and(eq(leaveRequest.employeeId, scope.employeeId), isNull(leaveRequest.deletedAt), where));
}

type OwnLeaveRaw = Awaited<ReturnType<typeof selectOwnLeaves>>[number];

function toPortalRow(r: OwnLeaveRaw) {
  return {
    id: r.id,
    leaveTypeId: r.leaveTypeId,
    leaveTypeName: r.leaveTypeName,
    color: r.color,
    startDate: r.startDate,
    endDate: r.endDate,
    startHalf: r.startHalf,
    endHalf: r.endHalf,
    workingDays: toDays(r.workingDays),
    status: r.status,
    rejectReason: r.rejectReason,
    note: r.note,
    source: r.source,
    addedByHr: r.source === "operator",
    changedByHr: r.hrChangedAt !== null,
    submittedAt: iso(r.submittedAt),
    decidedAt: iso(r.decidedAt),
    attachmentCount: r.attachmentCount,
  };
}
export type PortalLeave = ReturnType<typeof toPortalRow>;

async function loadOwnLeave(conn: Conn, scope: PortalScope, id: string): Promise<PortalLeave> {
  const [row] = await selectOwnLeaves(conn, scope, eq(leaveRequest.id, id));
  if (!row) throw notFound();
  return toPortalRow(row);
}

export async function listOwnLeaves(scope: PortalScope): Promise<PortalLeave[]> {
  const rows = await selectOwnLeaves(db, scope).orderBy(desc(leaveRequest.startDate), desc(leaveRequest.createdAt));
  return rows.map(toPortalRow);
}

// ---------- reference (inputs of the live day count) ----------

export async function getPortalReference(scope: PortalScope, q: z.infer<typeof portalReferenceQuerySchema>) {
  const settings = await loadSettings(db);
  const [me] = await db
    .select({ workDaysOverride: employee.workDaysOverride })
    .from(employee)
    .where(eq(employee.id, scope.employeeId));
  const leaveTypes = await db
    .select({
      id: leaveType.id,
      code: leaveType.code,
      name: leaveType.name,
      color: leaveType.color,
      deductsBalance: leaveType.deductsBalance,
      dayCountMode: leaveType.dayCountMode,
      requiresAttachment: leaveType.requiresAttachment,
    })
    .from(leaveType)
    .where(eq(leaveType.isActive, true))
    .orderBy(asc(leaveType.sortOrder), asc(leaveType.name));
  const holidays = await db
    .select({ date: holiday.date, name: holiday.name, isHalfDay: holiday.isHalfDay })
    .from(holiday)
    .where(and(q.from ? gte(holiday.date, q.from) : undefined, q.to ? lte(holiday.date, q.to) : undefined))
    .orderBy(asc(holiday.date));
  return {
    workDays: me?.workDaysOverride ?? settings.workDays,
    leaveTypes,
    holidays,
    settings: { allowNegative: settings.allowNegative, negativeLimitDays: toDays(settings.negativeLimitDays) },
  };
}

// ---------- dashboard ----------

export async function getDashboard(scope: PortalScope) {
  const today = todayIso();
  const [me] = await db
    .select({ fullName: employee.fullName, department: department.name, hireDate: employee.hireDate })
    .from(employee)
    .innerJoin(department, eq(department.id, employee.departmentId))
    .where(eq(employee.id, scope.employeeId));
  if (!me) throw notFound();

  // Balance cards: deducting, active types that have a policy in force today or any ledger row
  // for this employee (a type nobody ever accrues stays off the home screen).
  const withPolicy = db
    .select({ id: leavePolicy.leaveTypeId })
    .from(leavePolicy)
    .where(lte(leavePolicy.effectiveFrom, today));
  const withLedger = db
    .select({ id: ledgerEntry.leaveTypeId })
    .from(ledgerEntry)
    .where(eq(ledgerEntry.employeeId, scope.employeeId));
  const types = await db
    .select({ id: leaveType.id, name: leaveType.name, color: leaveType.color })
    .from(leaveType)
    .where(
      and(
        eq(leaveType.deductsBalance, true),
        eq(leaveType.isActive, true),
        or(inArray(leaveType.id, withPolicy), inArray(leaveType.id, withLedger)),
      ),
    )
    .orderBy(asc(leaveType.sortOrder), asc(leaveType.name));
  const sums = (await loadBalances(db, [scope.employeeId], today)).get(scope.employeeId) ?? {};
  const balances = types.map((t) => {
    const b = sums[t.id] ?? { balance: 0, taken: 0, pending: 0, available: 0 };
    return { leaveTypeId: t.id, name: t.name, color: t.color, ...b };
  });

  const pending = (
    await selectOwnLeaves(db, scope, eq(leaveRequest.status, "pending")).orderBy(asc(leaveRequest.startDate))
  ).map(toPortalRow);
  const upcoming = (
    await selectOwnLeaves(db, scope, and(eq(leaveRequest.status, "approved"), gte(leaveRequest.endDate, today))).orderBy(
      asc(leaveRequest.startDate),
    )
  ).map(toPortalRow);

  // Decision banner: the latest UNREAD in-app approve/reject notification of this employee.
  const [latest] = await db
    .select({
      notificationId: notification.id,
      kind: notification.kind,
      createdAt: notification.createdAt,
      leaveRequestId: notification.leaveRequestId,
    })
    .from(notification)
    .innerJoin(leaveRequest, eq(leaveRequest.id, notification.leaveRequestId))
    .where(
      and(
        eq(notification.recipient, "employee"),
        eq(notification.recipientEmployeeId, scope.employeeId),
        eq(leaveRequest.employeeId, scope.employeeId),
        isNull(leaveRequest.deletedAt),
        eq(notification.channel, "in_app"),
        inArray(notification.kind, ["approved", "rejected"]),
        isNull(notification.readAt),
      ),
    )
    .orderBy(desc(notification.createdAt))
    .limit(1);
  let decision = null;
  if (latest?.leaveRequestId) {
    const leave = await loadOwnLeave(db, scope, latest.leaveRequestId);
    decision = {
      notificationId: latest.notificationId,
      kind: latest.kind as "approved" | "rejected",
      createdAt: latest.createdAt.toISOString(),
      leave: {
        id: leave.id,
        leaveTypeName: leave.leaveTypeName,
        color: leave.color,
        startDate: leave.startDate,
        endDate: leave.endDate,
        startHalf: leave.startHalf,
        endHalf: leave.endHalf,
        workingDays: leave.workingDays,
        status: leave.status,
        rejectReason: leave.rejectReason,
      },
    };
  }

  const nextHolidays = await db
    .select({ date: holiday.date, name: holiday.name, isHalfDay: holiday.isHalfDay })
    .from(holiday)
    .where(gte(holiday.date, today))
    .orderBy(asc(holiday.date))
    .limit(3);

  return { me, balances, pending, upcoming, decision, nextHolidays };
}

// ---------- own ledger (read-only) ----------

export async function getOwnLedger(scope: PortalScope, leaveTypeId: string) {
  const rows = await db
    .select({
      id: ledgerEntry.id,
      entryType: ledgerEntry.entryType,
      days: ledgerEntry.days,
      effectiveDate: ledgerEntry.effectiveDate,
      note: ledgerEntry.note,
      leaveRequestId: ledgerEntry.leaveRequestId,
      createdAt: ledgerEntry.createdAt,
    })
    .from(ledgerEntry)
    .where(and(eq(ledgerEntry.employeeId, scope.employeeId), eq(ledgerEntry.leaveTypeId, leaveTypeId)))
    .orderBy(asc(ledgerEntry.effectiveDate), asc(ledgerEntry.createdAt));
  const entries = withRunningBalance(
    rows.map((r) => ({ ...r, days: toDays(r.days), createdAt: r.createdAt.toISOString() })),
  );
  return { leaveTypeId, entries };
}

// ---------- team ("Away" projection only) ----------

/**
 * Teammates' APPROVED, non-deleted leaves overlapping [from, to], as the six-column "Away"
 * projection. A dedicated select of exactly those columns: type, note, status, attachments and
 * balances are never read here, so they can never leak.
 */
export async function getTeam(scope: PortalScope, q: PortalTeamQuery): Promise<PortalTeamResponse> {
  const settings = await loadSettings(db);
  const visibility = settings.teamVisibility;
  if (visibility === "off") return { scope: "off", people: [] };

  const myDepartment = db
    .select({ id: employee.departmentId })
    .from(employee)
    .where(eq(employee.id, scope.employeeId));
  const people: AwayEntry[] = await db
    .select({
      employeeId: employee.id,
      fullName: employee.fullName,
      startDate: leaveRequest.startDate,
      endDate: leaveRequest.endDate,
      startHalf: leaveRequest.startHalf,
      endHalf: leaveRequest.endHalf,
    })
    .from(leaveRequest)
    .innerJoin(employee, eq(employee.id, leaveRequest.employeeId))
    .where(
      and(
        eq(leaveRequest.status, "approved"),
        isNull(leaveRequest.deletedAt),
        lte(leaveRequest.startDate, q.to),
        gte(leaveRequest.endDate, q.from),
        ne(employee.id, scope.employeeId),
        eq(employee.status, "active"),
        visibility === "department" ? inArray(employee.departmentId, myDepartment) : undefined,
      ),
    )
    .orderBy(asc(leaveRequest.startDate), asc(employee.fullName));
  return { scope: visibility, people };
}

// ---------- preview (read-only) ----------

export async function previewOwnLeave(scope: PortalScope, input: z.infer<typeof portalPreviewSchema>) {
  const draft = { ...input, employeeId: scope.employeeId };
  const r = await checkLeave(db, draft, { context: "portal", attachmentPresent: input.hasAttachment });
  const visibility = r.settings.teamVisibility;
  return {
    days: r.dayCount.days,
    weekendDays: r.dayCount.weekendDays,
    holidayDays: r.dayCount.holidayDays,
    balance: r.balance,
    conflicts: portalConflictsView(r.conflicts, visibility),
    // The strip covers at most PORTAL_TEAM_MAX_DAYS from the start (same bound as /me/team).
    team: await getTeam(scope, {
      from: input.startDate,
      to: [input.endDate, addIsoDays(input.startDate, PORTAL_TEAM_MAX_DAYS - 1)].sort()[0]!, // earlier ISO date
    }),
  };
}

// ---------- submit (spec 1.7 + 4.3 sync rule 1) ----------

const auditView = (l: typeof leaveRequest.$inferSelect) => ({
  employeeId: l.employeeId,
  leaveTypeId: l.leaveTypeId,
  startDate: l.startDate,
  endDate: l.endDate,
  startHalf: l.startHalf,
  endHalf: l.endHalf,
  workingDays: l.workingDays,
  status: l.status,
  note: l.note,
  source: l.source,
  hasWarning: l.hasWarning,
  withdrawnAt: iso(l.withdrawnAt),
});

/** 422 with the employee-safe conflict view, so the sheet can show what to fix. */
function rejectSubmit(code: string, conflicts: ConflictResult): never {
  throw new DomainError(code, 422, undefined, { conflicts });
}

export async function submitLeave(
  scope: PortalScope,
  input: z.infer<typeof portalLeaveSubmitSchema>,
  file: File | undefined,
): Promise<PortalLeave> {
  // Validate the file (size, magic bytes) before anything is written.
  const upload = file ? await checkUpload(file) : null;

  const run = (storageKey: string | null) =>
    db.transaction(async (tx) => {
      await lockEmployee(tx, scope.employeeId);
      const draft = { ...input, employeeId: scope.employeeId };
      const check = await checkLeave(tx, draft, { context: "portal", attachmentPresent: upload !== null });
      if (!check.leaveType.isActive) throw new DomainError(PORTAL_ERRORS.typeInactive, 422);

      const view = portalConflictsView(check.conflicts, check.settings.teamVisibility);
      const verdict = portalSubmitVerdict(check.conflicts, input.acknowledgeNegative);
      if (!verdict.ok) {
        rejectSubmit(verdict.reason === "blocked" ? "leave.errors.blocked" : PORTAL_ERRORS.acknowledgeNegative, view);
      }

      const [created] = await tx
        .insert(leaveRequest)
        .values({
          employeeId: scope.employeeId,
          leaveTypeId: input.leaveTypeId,
          startDate: input.startDate,
          endDate: input.endDate,
          startHalf: input.startHalf,
          endHalf: input.endHalf,
          workingDays: fromDays(check.dayCount.days), // the server's count, never the client's
          status: "pending",
          note: input.note,
          hasWarning: check.conflicts.warnings.length > 0,
          conflictResult: check.conflicts, // operator-facing: keeps "certificate expected" etc.
          source: "portal",
          submittedAt: new Date(),
        })
        .returning();
      const leave = created!;
      if (upload && storageKey) await insertAttachment(tx, leave.id, upload, storageKey, scope.userId);
      await notifyOperator(tx, leave.id, "submitted");
      await writeAudit(tx, {
        entity: "leave_request",
        entityId: leave.id,
        action: "leave.submit",
        actor: scope.userId,
        after: auditView(leave),
      });
      return loadOwnLeave(tx, scope, leave.id);
    });

  const created = upload ? await withStoredFile(upload.bytes, run) : await run(null);
  publishLeaveEvent("leave.submitted", { id: created.id, employeeId: scope.employeeId });
  return created;
}

// ---------- withdraw (spec 4.3 sync rule 6: first writer wins) ----------

export async function withdrawLeave(scope: PortalScope, id: string): Promise<PortalLeave> {
  const row = await db.transaction(async (tx) => {
    // Same lock order as the operator side (employee lock, then the row) so the two serialize.
    await lockEmployee(tx, scope.employeeId);
    const [before] = await tx
      .select()
      .from(leaveRequest)
      .where(and(eq(leaveRequest.id, id), eq(leaveRequest.employeeId, scope.employeeId), isNull(leaveRequest.deletedAt)))
      .for("update");
    if (!before) throw notFound();
    if (before.status !== "pending") throw new DomainError(PORTAL_ERRORS.alreadyDecided, 409, { status: before.status });

    // Pending → cancelled: nothing was ever written to the ledger, so nothing to reverse.
    const [after] = await tx
      .update(leaveRequest)
      .set({ status: "cancelled", withdrawnAt: new Date() })
      .where(eq(leaveRequest.id, id))
      .returning();
    await notifyOperator(tx, id, "withdrawn");
    await writeAudit(tx, {
      entity: "leave_request",
      entityId: id,
      action: "leave.withdraw",
      actor: scope.userId,
      before: auditView(before),
      after: auditView(after!),
    });
    return loadOwnLeave(tx, scope, id);
  });
  publishLeaveEvent("leave.withdrawn", { id: row.id, employeeId: scope.employeeId });
  return row;
}

// ---------- own attachment removal (pending only) ----------

export async function deleteOwnAttachment(scope: PortalScope, attachmentId: string) {
  const leaveId = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ a: attachment, status: leaveRequest.status })
      .from(attachment)
      .innerJoin(leaveRequest, eq(leaveRequest.id, attachment.leaveRequestId))
      .where(
        and(
          eq(attachment.id, attachmentId),
          isNull(attachment.deletedAt),
          eq(leaveRequest.employeeId, scope.employeeId),
          isNull(leaveRequest.deletedAt),
        ),
      )
      .for("update");
    if (!row) throw notFound();
    if (row.status !== "pending") throw new DomainError(PORTAL_ERRORS.notPending, 409);
    await softDeleteAttachment(tx, row.a, scope.userId);
    return row.a.leaveRequestId;
  });
  publishLeaveEvent("leave.changed", { id: leaveId, employeeId: scope.employeeId });
  return { ok: true as const };
}

/** Own attachments of one own leave (metadata only), for the request detail. */
export async function listOwnAttachments(scope: PortalScope, leaveRequestId: string) {
  const rows = await db
    .select({
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      uploadedAt: attachment.uploadedAt,
    })
    .from(attachment)
    .innerJoin(leaveRequest, eq(leaveRequest.id, attachment.leaveRequestId))
    .where(
      and(
        eq(attachment.leaveRequestId, leaveRequestId),
        isNull(attachment.deletedAt),
        eq(leaveRequest.employeeId, scope.employeeId),
        isNull(leaveRequest.deletedAt),
      ),
    )
    .orderBy(desc(attachment.uploadedAt));
  return rows.map((r) => ({ ...r, uploadedAt: r.uploadedAt.toISOString() }));
}

// ---------- notifications ----------

export async function markNotificationRead(scope: PortalScope, id: string) {
  const [row] = await db
    .update(notification)
    .set({ readAt: sql`coalesce(${notification.readAt}, now())` })
    .where(
      and(
        eq(notification.id, id),
        eq(notification.recipient, "employee"),
        eq(notification.recipientEmployeeId, scope.employeeId),
      ),
    )
    .returning({ id: notification.id });
  if (!row) throw notFound();
  return { ok: true as const };
}
