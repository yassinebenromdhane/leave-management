// Ledger writes and balance reads (spec 4.2 rules 2-5). ledger_entry is append-only: this module
// only ever INSERTs. Balances are computed with @leave/shared from ledger rows, never stored.
import {
  summarizeBalance,
  withRunningBalance,
  type BalanceSummary,
  type EntryType,
  type LedgerLine,
} from "@leave/shared";
import { and, asc, eq, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import { fromDays, toDays } from "../db/days";
import { leaveRequest, leaveType, ledgerEntry } from "../db/schema";
import { todayIso } from "./today";

type Conn = Db | Tx;

export type NewLedgerEntry = {
  employeeId: string;
  leaveTypeId: string;
  entryType: EntryType;
  days: number;
  effectiveDate: string;
  leaveRequestId?: string | null;
  periodKey?: string | null;
  note?: string | null;
};

export async function insertLedgerEntry(tx: Tx, e: NewLedgerEntry) {
  const [row] = await tx
    .insert(ledgerEntry)
    .values({
      employeeId: e.employeeId,
      leaveTypeId: e.leaveTypeId,
      entryType: e.entryType,
      days: fromDays(e.days),
      effectiveDate: e.effectiveDate,
      leaveRequestId: e.leaveRequestId ?? null,
      periodKey: e.periodKey ?? null,
      note: e.note ?? null,
    })
    .returning();
  return row!;
}

type LeaveForLedger = {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  workingDays: number;
};

/** Rule 4: approval consumes the snapshot, dated on the first day of the leave. */
export const writeLeaveEntry = (tx: Tx, l: LeaveForLedger) =>
  insertLedgerEntry(tx, {
    employeeId: l.employeeId,
    leaveTypeId: l.leaveTypeId,
    entryType: "leave",
    days: -l.workingDays,
    effectiveDate: l.startDate,
    leaveRequestId: l.id,
  });

/** Rules 4-5: leaving "approved" (reject, cancel, delete, edit) gives the snapshot back. */
export const writeReversal = (tx: Tx, l: LeaveForLedger) =>
  insertLedgerEntry(tx, {
    employeeId: l.employeeId,
    leaveTypeId: l.leaveTypeId,
    entryType: "reversal",
    days: l.workingDays,
    effectiveDate: l.startDate,
    leaveRequestId: l.id,
  });

export type BalancesByType = Record<string, BalanceSummary>;

/**
 * Balance / taken / pending / available at `onDate` for every deducting, active leave type of
 * the given employees (all employees when `employeeIds` is undefined). Three queries in total:
 * leave types, ledger sums grouped by (employee, type, entry type), pending sums.
 */
export async function loadBalances(
  conn: Conn,
  employeeIds: readonly string[] | undefined,
  onDate: string = todayIso(),
): Promise<Map<string, BalancesByType>> {
  const out = new Map<string, BalancesByType>();
  if (employeeIds && employeeIds.length === 0) return out;

  const types = await conn
    .select({ id: leaveType.id })
    .from(leaveType)
    .where(and(eq(leaveType.deductsBalance, true), eq(leaveType.isActive, true)));
  if (types.length === 0) return out;
  const typeIds = types.map((t) => t.id);

  const empFilter = (col: typeof ledgerEntry.employeeId | typeof leaveRequest.employeeId): SQL | undefined =>
    employeeIds ? inArray(col, [...employeeIds]) : undefined;

  const ledgerSums = await conn
    .select({
      employeeId: ledgerEntry.employeeId,
      leaveTypeId: ledgerEntry.leaveTypeId,
      entryType: ledgerEntry.entryType,
      days: sql<string>`sum(${ledgerEntry.days})`,
    })
    .from(ledgerEntry)
    .where(
      and(empFilter(ledgerEntry.employeeId), inArray(ledgerEntry.leaveTypeId, typeIds), lte(ledgerEntry.effectiveDate, onDate)),
    )
    .groupBy(ledgerEntry.employeeId, ledgerEntry.leaveTypeId, ledgerEntry.entryType);

  const pendingSums = await conn
    .select({
      employeeId: leaveRequest.employeeId,
      leaveTypeId: leaveRequest.leaveTypeId,
      days: sql<string>`sum(${leaveRequest.workingDays})`,
    })
    .from(leaveRequest)
    .where(
      and(
        empFilter(leaveRequest.employeeId),
        inArray(leaveRequest.leaveTypeId, typeIds),
        eq(leaveRequest.status, "pending"),
        isNull(leaveRequest.deletedAt),
      ),
    )
    .groupBy(leaveRequest.employeeId, leaveRequest.leaveTypeId);

  // Aggregated rows are valid ledger lines (one per entry type, already <= onDate).
  const key = (e: string, t: string) => `${e}|${t}`;
  const lines = new Map<string, LedgerLine[]>();
  for (const r of ledgerSums) {
    const k = key(r.employeeId, r.leaveTypeId);
    const list = lines.get(k) ?? [];
    list.push({ days: toDays(r.days), effectiveDate: onDate, entryType: r.entryType });
    lines.set(k, list);
  }
  const pending = new Map(pendingSums.map((r) => [key(r.employeeId, r.leaveTypeId), toDays(r.days)]));

  const ids = new Set<string>(employeeIds ?? [...ledgerSums.map((r) => r.employeeId), ...pendingSums.map((r) => r.employeeId)]);
  for (const empId of ids) {
    const byType: BalancesByType = {};
    for (const typeId of typeIds) {
      const k = key(empId, typeId);
      const p = pending.get(k);
      byType[typeId] = summarizeBalance({
        entries: lines.get(k) ?? [],
        pending: p === undefined ? [] : [{ workingDays: p }],
        onDate,
      });
    }
    out.set(empId, byType);
  }
  return out;
}

/** Empty balances for employees without any row yet (list view of a fresh employee). */
export async function balancesFor(conn: Conn, employeeId: string): Promise<BalancesByType> {
  return (await loadBalances(conn, [employeeId])).get(employeeId) ?? {};
}

/**
 * Days available to a NEW or EDITED leave, for the negative-balance check and the "12 → 7.5"
 * preview. Same rule-3 formula as everywhere (balance − reserved), with two choices the spec
 * leaves open:
 * - The balance is read at max(today, leave start), and approved leave already booked LATER
 *   (future `leave` / `reversal` rows) is counted too, so two future leaves can never both
 *   spend the same days.
 * - Ledger rows and the pending reservation of the leave being edited/approved/restored
 *   (`excludeLeaveId`) are left out, which gives its own consumption back before re-checking.
 */
export async function availableForLeave(
  conn: Conn,
  input: { employeeId: string; leaveTypeId: string; startDate: string; excludeLeaveId?: string | undefined },
): Promise<number> {
  const today = todayIso();
  const checkDate = input.startDate > today ? input.startDate : today;
  const notExcludedLedger = input.excludeLeaveId
    ? or(isNull(ledgerEntry.leaveRequestId), ne(ledgerEntry.leaveRequestId, input.excludeLeaveId))
    : undefined;

  const entries = await conn
    .select({ days: ledgerEntry.days, effectiveDate: ledgerEntry.effectiveDate, entryType: ledgerEntry.entryType })
    .from(ledgerEntry)
    .where(
      and(
        eq(ledgerEntry.employeeId, input.employeeId),
        eq(ledgerEntry.leaveTypeId, input.leaveTypeId),
        or(lte(ledgerEntry.effectiveDate, checkDate), inArray(ledgerEntry.entryType, ["leave", "reversal"])),
        notExcludedLedger,
      ),
    );
  const pending = await conn
    .select({ workingDays: leaveRequest.workingDays })
    .from(leaveRequest)
    .where(
      and(
        eq(leaveRequest.employeeId, input.employeeId),
        eq(leaveRequest.leaveTypeId, input.leaveTypeId),
        eq(leaveRequest.status, "pending"),
        isNull(leaveRequest.deletedAt),
        input.excludeLeaveId ? ne(leaveRequest.id, input.excludeLeaveId) : undefined,
      ),
    );

  // Every selected row counts (the date filter is in SQL above), so they are all read at checkDate.
  return summarizeBalance({
    entries: entries.map((e) => ({ entryType: e.entryType, days: toDays(e.days), effectiveDate: checkDate })),
    pending: pending.map((p) => ({ workingDays: toDays(p.workingDays) })),
    onDate: checkDate,
  }).available;
}

export type LedgerViewLine = {
  id: string;
  entryType: EntryType;
  days: number;
  effectiveDate: string;
  note: string | null;
  leaveRequestId: string | null;
  createdAt: string;
  runningBalance: number;
};

/** Ledger view (employee drawer): every entry per leave type with its running balance. */
export async function ledgerByType(conn: Conn, employeeId: string): Promise<Record<string, LedgerViewLine[]>> {
  const rows = await conn
    .select()
    .from(ledgerEntry)
    .where(eq(ledgerEntry.employeeId, employeeId))
    .orderBy(asc(ledgerEntry.effectiveDate), asc(ledgerEntry.createdAt));
  const grouped = new Map<string, Omit<LedgerViewLine, "runningBalance">[]>();
  for (const r of rows) {
    const list = grouped.get(r.leaveTypeId) ?? [];
    list.push({
      id: r.id,
      entryType: r.entryType,
      days: toDays(r.days),
      effectiveDate: r.effectiveDate,
      note: r.note,
      leaveRequestId: r.leaveRequestId,
      createdAt: r.createdAt.toISOString(),
    });
    grouped.set(r.leaveTypeId, list);
  }
  const out: Record<string, LedgerViewLine[]> = {};
  for (const [typeId, list] of grouped) out[typeId] = withRunningBalance(list);
  return out;
}
