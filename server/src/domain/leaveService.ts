// Operator leave logging (spec 1.2, 1.3, 4.2 rules 4-5). Every mutation is ONE transaction:
// per-employee advisory lock → SELECT … FOR UPDATE → server-side day count + blocking checks →
// leave_request write → ledger INSERTs (append-only) → audit_log (+ employee notification).
// Realtime events (leave.changed / leave.decided) and decision emails go out AFTER commit: every
// exported mutation awaits its transaction first, then publishes.
import type { ConflictResult, LeaveBulkStatusInput, LeaveStatus, LeaveStatusChangeInput } from "@leave/shared";
import type {
  leaveCreateSchema,
  leaveListQuerySchema,
  leavePreviewSchema,
  leaveUpdateSchema,
} from "@leave/shared";
import { and, asc, desc, eq, gte, isNotNull, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { db, type Db, type Tx } from "../db/client";
import { fromDays, toDays } from "../db/days";
import { attachment, department, employee, leaveRequest, leaveType } from "../db/schema";
import { writeAudit } from "./audit";
import {
  assertNotBlocked,
  checkLeave,
  dayCountFor,
  hasAttachment,
  loadSettings,
  lockEmployee,
  type LeaveDraft,
} from "./conflictChecker";
import { publishLeaveEvent } from "../realtime/bus";
import { DomainError, notFound } from "./errors";
import { writeLeaveEntry, writeReversal } from "./ledgerService";
import { notifyEmployee, queueDecisionEmail } from "./notificationService";
import { todayIso } from "./today";

type Conn = Db | Tx;
type LeaveRow = typeof leaveRequest.$inferSelect;

// ---------- read model ----------

const attachmentCount = sql<number>`(
  select count(*)::int from ${attachment}
  where ${attachment.leaveRequestId} = ${leaveRequest.id} and ${attachment.deletedAt} is null
)`;

const listColumns = {
  id: leaveRequest.id,
  employeeId: leaveRequest.employeeId,
  employeeName: employee.fullName,
  departmentId: employee.departmentId,
  departmentName: department.name,
  leaveTypeId: leaveRequest.leaveTypeId,
  leaveTypeName: leaveType.name,
  color: leaveType.color,
  startDate: leaveRequest.startDate,
  endDate: leaveRequest.endDate,
  startHalf: leaveRequest.startHalf,
  endHalf: leaveRequest.endHalf,
  workingDays: leaveRequest.workingDays,
  status: leaveRequest.status,
  note: leaveRequest.note,
  rejectReason: leaveRequest.rejectReason,
  hasWarning: leaveRequest.hasWarning,
  source: leaveRequest.source,
  hrChangedAt: leaveRequest.hrChangedAt,
  submittedAt: leaveRequest.submittedAt,
  decidedAt: leaveRequest.decidedAt,
  createdAt: leaveRequest.createdAt,
  attachmentCount,
  conflictResult: leaveRequest.conflictResult,
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toListRow(r: Awaited<ReturnType<typeof selectLeaves>>[number]) {
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeName: r.employeeName,
    departmentId: r.departmentId,
    departmentName: r.departmentName,
    leaveTypeId: r.leaveTypeId,
    leaveTypeName: r.leaveTypeName,
    color: r.color,
    startDate: r.startDate,
    endDate: r.endDate,
    startHalf: r.startHalf,
    endHalf: r.endHalf,
    workingDays: toDays(r.workingDays),
    status: r.status,
    note: r.note,
    rejectReason: r.rejectReason,
    hasWarning: r.hasWarning,
    source: r.source,
    hrChangedAt: iso(r.hrChangedAt),
    submittedAt: iso(r.submittedAt),
    decidedAt: iso(r.decidedAt),
    createdAt: r.createdAt.toISOString(),
    attachmentCount: r.attachmentCount,
  };
}
export type LeaveListRow = ReturnType<typeof toListRow>;

function selectLeaves(conn: Conn, where: SQL | undefined, order: "asc" | "desc" = "asc") {
  const dir = order === "asc" ? asc : desc;
  return conn
    .select(listColumns)
    .from(leaveRequest)
    .innerJoin(employee, eq(employee.id, leaveRequest.employeeId))
    .innerJoin(department, eq(department.id, employee.departmentId))
    .innerJoin(leaveType, eq(leaveType.id, leaveRequest.leaveTypeId))
    .where(and(isNull(leaveRequest.deletedAt), where))
    .orderBy(dir(leaveRequest.startDate), dir(leaveRequest.createdAt));
}

export type LeaveListFilters = z.infer<typeof leaveListQuerySchema>;

export async function listLeaves(f: LeaveListFilters, order: "asc" | "desc" = "asc"): Promise<LeaveListRow[]> {
  const rows = await selectLeaves(
    db,
    and(
      f.to ? lte(leaveRequest.startDate, f.to) : undefined,
      f.from ? gte(leaveRequest.endDate, f.from) : undefined,
      f.status ? eq(leaveRequest.status, f.status) : undefined,
      f.departmentId ? eq(employee.departmentId, f.departmentId) : undefined,
      f.employeeId ? eq(leaveRequest.employeeId, f.employeeId) : undefined,
      f.leaveTypeId ? eq(leaveRequest.leaveTypeId, f.leaveTypeId) : undefined,
    ),
    order,
  );
  return rows.map(toListRow);
}

async function loadListRow(conn: Conn, id: string): Promise<LeaveListRow> {
  const [row] = await selectLeaves(conn, eq(leaveRequest.id, id));
  if (!row) throw notFound();
  return toListRow(row);
}

export async function getLeave(id: string) {
  const [row] = await selectLeaves(db, eq(leaveRequest.id, id));
  if (!row) throw notFound();
  const files = await db
    .select({
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      uploadedAt: attachment.uploadedAt,
    })
    .from(attachment)
    .where(and(eq(attachment.leaveRequestId, id), isNull(attachment.deletedAt)))
    .orderBy(desc(attachment.uploadedAt));
  return {
    ...toListRow(row),
    conflictResult: (row.conflictResult ?? null) as ConflictResult | null,
    attachments: files.map((f) => ({ ...f, uploadedAt: f.uploadedAt.toISOString() })),
  };
}

// ---------- preview (read-only) ----------

export async function previewLeave(input: z.infer<typeof leavePreviewSchema>) {
  const r = await checkLeave(db, input, {
    context: "operator",
    excludeLeaveId: input.excludeLeaveId,
    attachmentPresent: input.hasAttachment,
  });
  return {
    days: r.dayCount.days,
    weekendDays: r.dayCount.weekendDays,
    holidayDays: r.dayCount.holidayDays,
    balance: r.balance,
    conflicts: r.conflicts,
  };
}

// ---------- helpers for mutations ----------

/** Audit snapshot of a leave request (no derived or personal data beyond the request itself). */
const auditView = (l: LeaveRow) => ({
  employeeId: l.employeeId,
  leaveTypeId: l.leaveTypeId,
  startDate: l.startDate,
  endDate: l.endDate,
  startHalf: l.startHalf,
  endHalf: l.endHalf,
  workingDays: l.workingDays,
  status: l.status,
  note: l.note,
  rejectReason: l.rejectReason,
  hasWarning: l.hasWarning,
  deletedAt: iso(l.deletedAt),
});

const ledgerView = (l: LeaveRow) => ({
  id: l.id,
  employeeId: l.employeeId,
  leaveTypeId: l.leaveTypeId,
  startDate: l.startDate,
  workingDays: toDays(l.workingDays),
});

async function deducts(tx: Tx, leaveTypeId: string): Promise<boolean> {
  const [t] = await tx.select({ d: leaveType.deductsBalance }).from(leaveType).where(eq(leaveType.id, leaveTypeId));
  return t?.d === true;
}

/**
 * Opens the transaction for an existing leave: per-employee lock, then the row FOR UPDATE.
 * Deleted leaves are 404 unless `allowDeleted` (restore).
 */
async function withLockedLeave<T>(
  id: string,
  fn: (tx: Tx, leave: LeaveRow) => Promise<T>,
  opts: { allowDeleted?: boolean } = {},
): Promise<T> {
  const [peek] = await db.select({ employeeId: leaveRequest.employeeId }).from(leaveRequest).where(eq(leaveRequest.id, id));
  if (!peek) throw notFound();
  return db.transaction(async (tx) => {
    await lockEmployee(tx, peek.employeeId);
    const [leave] = await tx.select().from(leaveRequest).where(eq(leaveRequest.id, id)).for("update");
    if (!leave || (leave.deletedAt && !opts.allowDeleted)) throw notFound();
    return fn(tx, leave);
  });
}

const draftOf = (l: LeaveRow): LeaveDraft => ({
  employeeId: l.employeeId,
  leaveTypeId: l.leaveTypeId,
  startDate: l.startDate,
  endDate: l.endDate,
  startHalf: l.startHalf,
  endHalf: l.endHalf,
});

/** Re-runs the blocking checks for an existing leave (approve, re-open, restore). */
async function recheck(tx: Tx, leave: LeaveRow): Promise<ConflictResult> {
  const r = await checkLeave(tx, draftOf(leave), {
    context: "operator",
    excludeLeaveId: leave.id,
    attachmentPresent: await hasAttachment(tx, leave.id),
  });
  assertNotBlocked(r.conflicts);
  return r.conflicts;
}

// ---------- create ----------

export async function createLeave(input: z.infer<typeof leaveCreateSchema>, actor: string) {
  const created = await db.transaction(async (tx) => {
    await lockEmployee(tx, input.employeeId);
    const check = await checkLeave(tx, input, { context: "operator", attachmentPresent: false });
    if (check.employee.status !== "active") throw new DomainError("employees.errors.archived", 409);
    if (!check.leaveType.isActive) throw new DomainError("leave.errors.typeInactive", 422);
    assertNotBlocked(check.conflicts);

    const status = input.status ?? check.leaveType.defaultSaveStatus ?? check.settings.defaultSaveStatus;
    const now = new Date();
    const [created] = await tx
      .insert(leaveRequest)
      .values({
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        startDate: input.startDate,
        endDate: input.endDate,
        startHalf: input.startHalf,
        endHalf: input.endHalf,
        workingDays: fromDays(check.dayCount.days), // the server's count, never the client's
        status,
        note: input.note,
        hasWarning: check.conflicts.warnings.length > 0,
        conflictResult: check.conflicts,
        source: "operator",
        decidedAt: status === "approved" ? now : null,
      })
      .returning();
    const leave = created!;

    if (status === "approved" && check.leaveType.deductsBalance) await writeLeaveEntry(tx, ledgerView(leave));
    await writeAudit(tx, { entity: "leave_request", entityId: leave.id, action: "leave.create", actor, after: auditView(leave) });
    return { ...(await loadListRow(tx, leave.id)), conflicts: check.conflicts };
  });
  publishLeaveEvent("leave.changed", created); // "added by HR" on the portal
  return created;
}

// ---------- edit ----------

export async function updateLeave(id: string, input: z.infer<typeof leaveUpdateSchema>, actor: string) {
  const updated = await withLockedLeave(id, async (tx, before) => {
    const draft: LeaveDraft = { ...input, employeeId: before.employeeId };
    const check = await checkLeave(tx, draft, {
      context: "operator",
      excludeLeaveId: id,
      attachmentPresent: await hasAttachment(tx, id),
    });
    if (!check.leaveType.isActive && input.leaveTypeId !== before.leaveTypeId) {
      throw new DomainError("leave.errors.typeInactive", 422);
    }
    assertNotBlocked(check.conflicts);

    const newDays = check.dayCount.days;
    const [updated] = await tx
      .update(leaveRequest)
      .set({
        leaveTypeId: input.leaveTypeId,
        startDate: input.startDate,
        endDate: input.endDate,
        startHalf: input.startHalf,
        endHalf: input.endHalf,
        note: input.note,
        workingDays: fromDays(newDays),
        hasWarning: check.conflicts.warnings.length > 0,
        conflictResult: check.conflicts,
        hrChangedAt: before.source === "portal" ? new Date() : before.hrChangedAt,
      })
      .where(eq(leaveRequest.id, id))
      .returning();
    const after = updated!;

    // Rule 5: an approved leave whose amount, date or type changed = reversal of the old
    // snapshot on the OLD type + new leave entry on the NEW type, in this same transaction.
    const ledgerChanged =
      before.leaveTypeId !== after.leaveTypeId ||
      before.startDate !== after.startDate ||
      toDays(before.workingDays) !== newDays;
    if (before.status === "approved" && ledgerChanged) {
      if (await deducts(tx, before.leaveTypeId)) await writeReversal(tx, ledgerView(before));
      if (check.leaveType.deductsBalance) await writeLeaveEntry(tx, ledgerView(after));
    }

    await writeAudit(tx, {
      entity: "leave_request",
      entityId: id,
      action: "leave.update",
      actor,
      before: auditView(before),
      after: auditView(after),
    });
    // Spec 4.3 sync rule 5: the employee sees "changed by HR" on a request they submitted.
    if (before.source === "portal") await notifyEmployee(tx, after, "changed");
    return { ...(await loadListRow(tx, id)), conflicts: check.conflicts };
  });
  publishLeaveEvent("leave.changed", updated);
  return updated;
}

// ---------- status ----------

const ACTIVE: readonly LeaveStatus[] = ["pending", "approved"];

async function applyStatus(tx: Tx, before: LeaveRow, input: LeaveStatusChangeInput, actor: string) {
  const to = input.status;
  // Withdrawn by the employee (portal) = final. A stale approve/reject that lost the race to the
  // withdraw gets a 409 instead of silently re-opening the request (spec 4.3 sync rule 6).
  if (before.withdrawnAt) throw new DomainError("leave.errors.withdrawn", 409);
  if (before.status === to) throw new DomainError("leave.errors.sameStatus", 409);
  // approved → pending is allowed (it backs the Undo of an approval): leaving `approved` writes a
  // reversal like any other exit, so the ledger nets to zero.

  // Becoming active again (approve, or re-open a rejected/cancelled one) re-runs blocking checks.
  let conflicts = (before.conflictResult ?? null) as ConflictResult | null;
  if (ACTIVE.includes(to) && (to === "approved" || !ACTIVE.includes(before.status))) {
    conflicts = await recheck(tx, before);
  }

  const now = new Date();
  const [updated] = await tx
    .update(leaveRequest)
    .set({
      status: to,
      rejectReason: to === "rejected" ? (input.reason ?? null) : null,
      decidedAt: to === "approved" || to === "rejected" ? now : before.decidedAt,
      ...(conflicts ? { conflictResult: conflicts, hasWarning: conflicts.warnings.length > 0 } : {}),
    })
    .where(eq(leaveRequest.id, before.id))
    .returning();
  const after = updated!;

  if (await deducts(tx, before.leaveTypeId)) {
    if (before.status === "approved") await writeReversal(tx, ledgerView(before));
    if (to === "approved") await writeLeaveEntry(tx, ledgerView(after));
  }

  await writeAudit(tx, {
    entity: "leave_request",
    entityId: before.id,
    action: `leave.status.${to}`,
    actor,
    before: auditView(before),
    after: auditView(after),
  });
  // Sync rule 3: the employee is told about every decision (approve / reject), and about any
  // other status move (cancel, Undo back to pending) as a "changed" note.
  await notifyEmployee(tx, after, to === "approved" || to === "rejected" ? to : "changed");
  return after;
}

/** After commit: realtime signal + (approve/reject) the decision email in the background. */
function afterStatusCommit(leave: LeaveRow): void {
  publishLeaveEvent("leave.decided", leave);
  if (leave.status === "approved" || leave.status === "rejected") queueDecisionEmail(leave.id);
}

export async function changeLeaveStatus(id: string, input: LeaveStatusChangeInput, actor: string) {
  const { after, row } = await withLockedLeave(id, async (tx, before) => {
    const changed = await applyStatus(tx, before, input, actor);
    return { after: changed, row: await loadListRow(tx, id) };
  });
  afterStatusCommit(after);
  return row;
}

/** Bulk approve: each id in its own transaction, so one blocked leave never rolls back the rest. */
export async function bulkChangeStatus(input: LeaveBulkStatusInput, actor: string) {
  const results: { id: string; ok: boolean; code?: string }[] = [];
  for (const id of new Set(input.ids)) {
    try {
      const after = await withLockedLeave(id, (tx, before) =>
        applyStatus(tx, before, { status: input.status, reason: null }, actor),
      );
      afterStatusCommit(after);
      results.push({ id, ok: true });
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      results.push({ id, ok: false, code: err.code });
    }
  }
  return { results };
}

// ---------- soft delete / restore (6-second Undo) ----------

export async function deleteLeave(id: string, actor: string) {
  const deleted = await withLockedLeave(id, async (tx, before) => {
    const [updated] = await tx
      .update(leaveRequest)
      .set({ deletedAt: new Date() })
      .where(eq(leaveRequest.id, id))
      .returning();
    if (before.status === "approved" && (await deducts(tx, before.leaveTypeId))) {
      await writeReversal(tx, ledgerView(before));
    }
    await writeAudit(tx, {
      entity: "leave_request",
      entityId: id,
      action: "leave.delete",
      actor,
      before: auditView(before),
      after: auditView(updated!),
    });
    return before;
  });
  publishLeaveEvent("leave.changed", deleted);
  return { ok: true as const };
}

export async function restoreLeave(id: string, actor: string) {
  const restored = await withLockedLeave(
    id,
    async (tx, before) => {
      if (!before.deletedAt) throw new DomainError("leave.errors.notDeleted", 409);
      const conflicts = ACTIVE.includes(before.status) ? await recheck(tx, before) : null;
      const [updated] = await tx
        .update(leaveRequest)
        .set({
          deletedAt: null,
          ...(conflicts ? { conflictResult: conflicts, hasWarning: conflicts.warnings.length > 0 } : {}),
        })
        .where(and(eq(leaveRequest.id, id), isNotNull(leaveRequest.deletedAt)))
        .returning();
      if (before.status === "approved" && (await deducts(tx, before.leaveTypeId))) {
        await writeLeaveEntry(tx, ledgerView(before));
      }
      await writeAudit(tx, {
        entity: "leave_request",
        entityId: id,
        action: "leave.restore",
        actor,
        before: auditView(before),
        after: auditView(updated!),
      });
      return loadListRow(tx, id);
    },
    { allowDeleted: true },
  );
  publishLeaveEvent("leave.changed", restored);
  return restored;
}

// ---------- rule 8: recalculation after a holiday change ----------

export type RecalcOutcome = { id: string; result: "updated" | "unchanged" } | { id: string; result: "skipped"; code: string };

/** Leaves whose snapshot follows holiday changes: Pending, and Approved ones not yet over. */
export const isRecalculable = (l: { status: LeaveStatus; endDate: string; deletedAt: Date | null }, today: string) =>
  l.deletedAt === null && (l.status === "pending" || (l.status === "approved" && l.endDate >= today));

/**
 * Spec 4.2 rule 8 confirm step for ONE leave, in its own transaction: re-verify it still needs a
 * recalculation, then pending → new working_days snapshot; approved → rule 5 (reversal of the old
 * snapshot + new leave entry when the type deducts). Sets hr_changed_at (portal "changed by HR").
 * A leave that would drop to 0 days is skipped, never cancelled automatically.
 */
export async function recalculateLeaveDays(id: string, actor: string): Promise<RecalcOutcome> {
  let employeeId: string | null = null;
  const outcome = await withLockedLeave(id, async (tx, before): Promise<RecalcOutcome> => {
    if (!isRecalculable(before, todayIso())) return { id, result: "unchanged" as const };
    const settings = await loadSettings(tx);
    const [emp] = await tx.select({ wd: employee.workDaysOverride }).from(employee).where(eq(employee.id, before.employeeId));
    const [type] = await tx
      .select({ mode: leaveType.dayCountMode, deducts: leaveType.deductsBalance })
      .from(leaveType)
      .where(eq(leaveType.id, before.leaveTypeId));
    const { days: newDays } = await dayCountFor(tx, before, { mode: type!.mode, workDays: emp?.wd ?? settings.workDays });
    if (newDays === toDays(before.workingDays)) return { id, result: "unchanged" as const };
    if (newDays === 0) return { id, result: "skipped" as const, code: "conflicts.zeroDays" };

    const [updated] = await tx
      .update(leaveRequest)
      .set({ workingDays: fromDays(newDays), hrChangedAt: new Date() })
      .where(eq(leaveRequest.id, id))
      .returning();
    const after = updated!;
    if (before.status === "approved" && type!.deducts) {
      await writeReversal(tx, ledgerView(before));
      await writeLeaveEntry(tx, ledgerView(after));
    }
    await writeAudit(tx, {
      entity: "leave_request",
      entityId: id,
      action: "leave.recalculate",
      actor,
      before: auditView(before),
      after: auditView(after),
    });
    await notifyEmployee(tx, after, "changed"); // portal: "changed by HR"
    employeeId = after.employeeId;
    return { id, result: "updated" as const };
  });
  if (employeeId) publishLeaveEvent("leave.changed", { id, employeeId });
  return outcome;
}
