// MVP manual "Run accrual" (spec 3.1, 4.2 rule 6). Amounts come from @leave/shared accrual rules;
// this module decides who, which type and which policy, then appends `accrual` ledger rows.
//
// - Employees: active ones, plus archived ones whose end_date is on/after the period start
//   (a leaver's last month still accrues, prorated). Never anyone hired after the period.
// - Leave types: active, deducting, with a policy effective at the period start (latest
//   effective_from <= first day of the month). A policy saved "from today" mid-month therefore
//   applies from the next run month.
// - Policy rates are DAYS PER LEAVE YEAR in both modes (employee override replaces them).
// - monthly policy → period_key "YYYY-MM", effective_date = first day of the month. The amount is
//   cumulative within the leave year (22 a year → 2, 1.5, 2, 2, 1.5… = exactly 22.0).
// - annual policy  → only when the period is the leave-year start month; period_key = leave-year
//   label ("Y2026" / "Y2026-27"), effective_date = leave-year start.
// - Idempotent through ledger_entry's unique (employee, type, entry_type, period_key) index +
//   ON CONFLICT DO NOTHING. Zero-day rows are never written.
import {
  accrualRate,
  annualGrantFor,
  isFuturePeriod,
  leaveYearLabel,
  monthBounds,
  monthlyAccrualFor,
  sumDays,
  type MonthKey,
} from "@leave/shared";
import { and, asc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { db, type Db, type Tx } from "../db/client";
import { fromDays, toDays } from "../db/days";
import { employee, leavePolicy, leaveType, ledgerEntry } from "../db/schema";
import { writeAudit } from "./audit";
import { loadSettings } from "./conflictChecker";
import { DomainError } from "./errors";
import { todayIso } from "./today";

type Conn = Db | Tx;

export type AccrualRow = {
  employeeId: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  accrualMode: "monthly" | "annual";
  periodKey: string;
  effectiveDate: string;
  days: number;
  alreadyDone: boolean;
};

async function computeAccrual(conn: Conn, period: MonthKey): Promise<AccrualRow[]> {
  if (isFuturePeriod(period, todayIso())) throw new DomainError("accrual.errors.futurePeriod", 422, { period });
  const { start, end } = monthBounds(period);
  const settings = await loadSettings(conn);
  const isLeaveYearStart = Number(period.slice(5, 7)) === settings.leaveYearStartMonth;

  const employees = await conn
    .select({
      id: employee.id,
      fullName: employee.fullName,
      hireDate: employee.hireDate,
      endDate: employee.endDate,
      override: employee.annualAllowanceOverride,
    })
    .from(employee)
    .where(
      and(
        lte(employee.hireDate, end),
        or(eq(employee.status, "active"), and(isNotNull(employee.endDate), gte(employee.endDate, start))),
      ),
    )
    .orderBy(asc(employee.fullName));

  const types = await conn
    .select({ id: leaveType.id, name: leaveType.name })
    .from(leaveType)
    .where(and(eq(leaveType.isActive, true), eq(leaveType.deductsBalance, true)))
    .orderBy(asc(leaveType.sortOrder), asc(leaveType.name));
  if (employees.length === 0 || types.length === 0) return [];

  // Every policy version effective by the period start, newest first per type: the latest one
  // governs this period; earlier ones give the rate of earlier months of the leave year (monthly
  // accrual is cumulative within the leave year, see monthlyAccrualFor).
  const allPolicies = await conn
    .select()
    .from(leavePolicy)
    .where(and(inArray(leavePolicy.leaveTypeId, types.map((t) => t.id)), lte(leavePolicy.effectiveFrom, start)))
    .orderBy(leavePolicy.leaveTypeId, sql`${leavePolicy.effectiveFrom} desc`);
  const policiesByType = new Map<string, typeof allPolicies>();
  for (const p of allPolicies) policiesByType.set(p.leaveTypeId, [...(policiesByType.get(p.leaveTypeId) ?? []), p]);
  /** The policy in force on the first day of `month` (versions are newest first). */
  const policyAt = (versions: typeof allPolicies, month: MonthKey) =>
    versions.find((v) => v.effectiveFrom <= monthBounds(month).start);

  const yearKey = leaveYearLabel(start);
  const candidates: AccrualRow[] = [];
  for (const t of types) {
    const versions = policiesByType.get(t.id) ?? [];
    const p = versions[0];
    if (!p) continue;
    if (p.accrualMode === "annual" && !isLeaveYearStart) continue;
    for (const e of employees) {
      const override = e.override === null ? null : toDays(e.override);
      const emp = { hireDate: e.hireDate, endDate: e.endDate, prorateHireMonth: p.prorateHireMonth };
      const days =
        p.accrualMode === "monthly"
          ? monthlyAccrualFor({
              ...emp,
              month: period,
              leaveYearStartMonth: settings.leaveYearStartMonth,
              // Days per leave year in force that month; months under an annual policy (granted
              // up front) or before any policy earn nothing here.
              annualRateFor: (month) => {
                const v = policyAt(versions, month);
                return v && v.accrualMode === "monthly" ? accrualRate({ rateDays: toDays(v.rateDays), override }) : 0;
              },
            })
          : annualGrantFor({ ...emp, rateDays: accrualRate({ rateDays: toDays(p.rateDays), override }), leaveYearStart: start });
      if (days === 0) continue;
      candidates.push({
        employeeId: e.id,
        employeeName: e.fullName,
        leaveTypeId: t.id,
        leaveTypeName: t.name,
        accrualMode: p.accrualMode,
        periodKey: p.accrualMode === "monthly" ? period : yearKey,
        effectiveDate: start,
        days,
        alreadyDone: false,
      });
    }
  }
  if (candidates.length === 0) return [];

  const done = await conn
    .select({ employeeId: ledgerEntry.employeeId, leaveTypeId: ledgerEntry.leaveTypeId, periodKey: ledgerEntry.periodKey })
    .from(ledgerEntry)
    .where(
      and(
        eq(ledgerEntry.entryType, "accrual"),
        inArray(ledgerEntry.periodKey, [...new Set(candidates.map((c) => c.periodKey))]),
        inArray(ledgerEntry.employeeId, employees.map((e) => e.id)),
      ),
    );
  const doneKeys = new Set(done.map((d) => `${d.employeeId}|${d.leaveTypeId}|${d.periodKey}`));
  for (const c of candidates) c.alreadyDone = doneKeys.has(`${c.employeeId}|${c.leaveTypeId}|${c.periodKey}`);
  return candidates;
}

const totalsOf = (rows: readonly AccrualRow[]) => {
  const todo = rows.filter((r) => !r.alreadyDone);
  return {
    rows: rows.length,
    toCreate: todo.length,
    alreadyDone: rows.length - todo.length,
    employees: new Set(todo.map((r) => r.employeeId)).size,
    days: sumDays(todo.map((r) => r.days)),
  };
};

export async function previewAccrual(period: MonthKey) {
  const rows = await computeAccrual(db, period);
  return { period, rows, totals: totalsOf(rows) };
}

export async function runAccrual(period: MonthKey, actor: string) {
  return db.transaction(async (tx) => {
    // One run at a time; the unique index still guarantees idempotency on its own.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('accrual-run'))`);
    const rows = await computeAccrual(tx, period);
    const todo = rows.filter((r) => !r.alreadyDone);
    const inserted =
      todo.length === 0
        ? []
        : await tx
            .insert(ledgerEntry)
            .values(
              todo.map((r) => ({
                employeeId: r.employeeId,
                leaveTypeId: r.leaveTypeId,
                entryType: "accrual" as const,
                days: fromDays(r.days),
                effectiveDate: r.effectiveDate,
                periodKey: r.periodKey,
              })),
            )
            .onConflictDoNothing()
            .returning({ days: ledgerEntry.days });
    const created = inserted.length;
    const skipped = rows.length - created;
    const days = sumDays(inserted.map((r) => toDays(r.days)));
    await writeAudit(tx, { entity: "accrual", entityId: period, action: "accrual.run", actor, after: { created, skipped, days } });
    return { period, created, skipped, days };
  });
}
