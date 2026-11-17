// Reports (spec 1.6): monthly payroll summary and leave detail, as JSON for the on-screen preview
// and as XLSX / CSV files. Days per period use shared daysInPeriod() (rule 9: day-by-day split on
// rule 1 values, the basis of monthSplit), balances use shared balanceAt() on ledger rows.
//
// Choices:
// - Payroll rows: employees employed during the period (active ones, and archived ones with an
//   end date on/after the period start), plus anyone with an approved leave in the period, so
//   archived employees stay in historical exports.
// - Type columns: every active type, plus inactive ones with approved days in the period.
// - Days in period are recomputed with the CURRENT holiday table. After a holiday change that the
//   operator has not recalculated (rule 8), they can differ from the leave's stored snapshot.
import {
  MAX_REPORT_SPAN_DAYS,
  addIsoDays,
  balanceAt,
  daysInPeriod,
  monthBounds,
  periodSpanDays,
  sumDays,
  type LedgerLine,
  type Period,
} from "@leave/shared";
import { and, asc, eq, exists, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import { toDays } from "../db/days";
import { attachment, department, employee, holiday, leaveRequest, leaveType, ledgerEntry } from "../db/schema";
import { colLabel, langOf } from "../services/exports/labels";
import type { ReportColumn, ReportRow, ReportTable } from "../services/exports/table";
import { toCsv, toXlsx } from "../services/exports/writers";
import { loadSettings } from "./conflictChecker";
import { DomainError } from "./errors";

function assertPeriod(p: Period) {
  if (p.from > p.to) throw new DomainError("reports.errors.endBeforeStart", 400);
  if (periodSpanDays(p) > MAX_REPORT_SPAN_DAYS) {
    throw new DomainError("reports.errors.periodTooLong", 422, { maxDays: MAX_REPORT_SPAN_DAYS });
  }
}

const overlaps = (p: Period) => and(lte(leaveRequest.startDate, p.to), gte(leaveRequest.endDate, p.from));

async function holidaysBetween(from: string, to: string) {
  return db
    .select({ date: holiday.date, isHalfDay: holiday.isHalfDay })
    .from(holiday)
    .where(and(gte(holiday.date, from), lte(holiday.date, to)));
}

type SpanRow = {
  startDate: string;
  endDate: string;
  startHalf: "full" | "am" | "pm";
  endHalf: "full" | "am" | "pm";
  mode: "working" | "calendar";
  workDays: number;
};

/** Days of each leave inside the period (shared rule), with the holidays loaded once. */
async function periodDays<T extends SpanRow>(rows: readonly T[], p: Period): Promise<number[]> {
  if (rows.length === 0) return [];
  const from = rows.reduce((m, r) => (r.startDate < m ? r.startDate : m), rows[0]!.startDate);
  const to = rows.reduce((m, r) => (r.endDate > m ? r.endDate : m), rows[0]!.endDate);
  const holidays = await holidaysBetween(from, to);
  return rows.map((r) =>
    daysInPeriod(
      {
        startDate: r.startDate,
        endDate: r.endDate,
        startHalf: r.startHalf,
        endHalf: r.endHalf,
        mode: r.mode,
        workDays: r.workDays,
        holidays: holidays.filter((h) => h.date >= r.startDate && h.date <= r.endDate),
      },
      p,
    ),
  );
}

// ---------- payroll summary ----------

export async function payrollReport(p: Period): Promise<ReportTable> {
  assertPeriod(p);
  const settings = await loadSettings(db);
  const lang = langOf(settings.locale);

  const approvedInPeriod = and(isNull(leaveRequest.deletedAt), eq(leaveRequest.status, "approved"), overlaps(p));
  const employees = await db
    .select({
      id: employee.id,
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      departmentName: department.name,
      workDaysOverride: employee.workDaysOverride,
    })
    .from(employee)
    .innerJoin(department, eq(department.id, employee.departmentId))
    .where(
      or(
        and(
          lte(employee.hireDate, p.to),
          or(isNull(employee.endDate), gte(employee.endDate, p.from)),
          or(eq(employee.status, "active"), isNotNull(employee.endDate)),
        ),
        exists(
          db
            .select({ one: sql`1` })
            .from(leaveRequest)
            .where(and(eq(leaveRequest.employeeId, employee.id), approvedInPeriod)),
        ),
      ),
    )
    .orderBy(asc(department.sortOrder), asc(department.name), asc(employee.fullName));
  const empIds = employees.map((e) => e.id);

  const leaves =
    empIds.length === 0
      ? []
      : await db
          .select({
            employeeId: leaveRequest.employeeId,
            leaveTypeId: leaveRequest.leaveTypeId,
            startDate: leaveRequest.startDate,
            endDate: leaveRequest.endDate,
            startHalf: leaveRequest.startHalf,
            endHalf: leaveRequest.endHalf,
            mode: leaveType.dayCountMode,
            workDaysOverride: employee.workDaysOverride,
          })
          .from(leaveRequest)
          .innerJoin(leaveType, eq(leaveType.id, leaveRequest.leaveTypeId))
          .innerJoin(employee, eq(employee.id, leaveRequest.employeeId))
          .where(and(approvedInPeriod, inArray(leaveRequest.employeeId, empIds)));
  const spans = leaves.map((l) => ({ ...l, workDays: l.workDaysOverride ?? settings.workDays }));
  const split = await periodDays(spans, p);

  // (employee|type) → days in period
  const used = new Map<string, number[]>();
  const typesUsed = new Set<string>();
  spans.forEach((l, i) => {
    const d = split[i]!;
    if (d === 0) return;
    const k = `${l.employeeId}|${l.leaveTypeId}`;
    used.set(k, [...(used.get(k) ?? []), d]);
    typesUsed.add(l.leaveTypeId);
  });

  const allTypes = await db.select().from(leaveType).orderBy(asc(leaveType.sortOrder), asc(leaveType.name));
  const types = allTypes.filter((t) => t.isActive || typesUsed.has(t.id));
  const deducting = types.filter((t) => t.deductsBalance);

  // Balances: shared balanceAt() over ledger rows up to the period end.
  const ledger =
    empIds.length === 0 || deducting.length === 0
      ? []
      : await db
          .select({
            employeeId: ledgerEntry.employeeId,
            leaveTypeId: ledgerEntry.leaveTypeId,
            days: ledgerEntry.days,
            effectiveDate: ledgerEntry.effectiveDate,
            entryType: ledgerEntry.entryType,
          })
          .from(ledgerEntry)
          .where(
            and(
              inArray(ledgerEntry.employeeId, empIds),
              inArray(ledgerEntry.leaveTypeId, deducting.map((t) => t.id)),
              lte(ledgerEntry.effectiveDate, p.to),
            ),
          );
  const lines = new Map<string, LedgerLine[]>();
  for (const e of ledger) {
    const k = `${e.employeeId}|${e.leaveTypeId}`;
    const list = lines.get(k) ?? [];
    list.push({ days: toDays(e.days), effectiveDate: e.effectiveDate, entryType: e.entryType });
    lines.set(k, list);
  }
  const dayBefore = addIsoDays(p.from, -1);

  const columns: ReportColumn[] = [
    { key: "employeeCode", label: colLabel(lang, "employeeCode"), kind: "text" },
    { key: "fullName", label: colLabel(lang, "fullName"), kind: "text" },
    { key: "department", label: colLabel(lang, "department"), kind: "text" },
    ...types.map((t): ReportColumn => ({ key: `type:${t.id}`, label: t.name, kind: "days" })),
    { key: "unpaidDays", label: colLabel(lang, "unpaidDays"), kind: "days" },
    ...deducting.flatMap((t): ReportColumn[] => [
      { key: `balanceStart:${t.id}`, label: colLabel(lang, "balanceStart", { type: t.name }), kind: "days" },
      { key: `balanceEnd:${t.id}`, label: colLabel(lang, "balanceEnd", { type: t.name }), kind: "days" },
    ]),
  ];

  const rows: ReportRow[] = employees.map((e) => {
    const row: ReportRow = { employeeId: e.id, employeeCode: e.employeeCode, fullName: e.fullName, department: e.departmentName };
    const unpaid: number[] = [];
    for (const t of types) {
      const d = sumDays(used.get(`${e.id}|${t.id}`) ?? []);
      row[`type:${t.id}`] = d;
      if (!t.isPaid) unpaid.push(d);
    }
    row.unpaidDays = sumDays(unpaid);
    for (const t of deducting) {
      const l = lines.get(`${e.id}|${t.id}`) ?? [];
      row[`balanceStart:${t.id}`] = balanceAt(l, dayBefore);
      row[`balanceEnd:${t.id}`] = balanceAt(l, p.to);
    }
    return row;
  });

  return { kind: "payroll", period: p, locale: settings.locale, columns, rows };
}

// ---------- leave detail ----------

export async function leaveDetailReport(p: Period): Promise<ReportTable> {
  assertPeriod(p);
  const settings = await loadSettings(db);
  const lang = langOf(settings.locale);
  const rows = await db
    .select({
      id: leaveRequest.id,
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      department: department.name,
      leaveType: leaveType.name,
      mode: leaveType.dayCountMode,
      workDaysOverride: employee.workDaysOverride,
      startDate: leaveRequest.startDate,
      endDate: leaveRequest.endDate,
      startHalf: leaveRequest.startHalf,
      endHalf: leaveRequest.endHalf,
      workingDays: leaveRequest.workingDays,
      status: leaveRequest.status,
      note: leaveRequest.note,
      source: leaveRequest.source,
      hasAttachment: sql<boolean>`exists (
        select 1 from ${attachment}
        where ${attachment.leaveRequestId} = ${leaveRequest.id} and ${attachment.deletedAt} is null
      )`,
    })
    .from(leaveRequest)
    .innerJoin(employee, eq(employee.id, leaveRequest.employeeId))
    .innerJoin(department, eq(department.id, employee.departmentId))
    .innerJoin(leaveType, eq(leaveType.id, leaveRequest.leaveTypeId))
    .where(and(isNull(leaveRequest.deletedAt), overlaps(p)))
    .orderBy(asc(leaveRequest.startDate), asc(employee.fullName), asc(leaveRequest.createdAt));
  const split = await periodDays(
    rows.map((r) => ({ ...r, workDays: r.workDaysOverride ?? settings.workDays })),
    p,
  );

  const c = (key: Parameters<typeof colLabel>[1], kind: ReportColumn["kind"], dict?: ReportColumn["dict"]): ReportColumn => ({
    key,
    label: colLabel(lang, key),
    kind,
    ...(dict ? { dict } : {}),
  });
  const columns: ReportColumn[] = [
    c("employeeCode", "text"),
    c("fullName", "text"),
    c("department", "text"),
    c("leaveType", "text"),
    c("startDate", "date"),
    c("endDate", "date"),
    c("startHalf", "enum", "half"),
    c("endHalf", "enum", "half"),
    c("days", "days"),
    c("daysInPeriod", "days"),
    c("status", "enum", "status"),
    c("note", "text"),
    c("attachment", "boolean"),
    c("source", "enum", "source"),
  ];
  return {
    kind: "leaveDetail",
    period: p,
    locale: settings.locale,
    columns,
    rows: rows.map((r, i) => ({
      leaveId: r.id,
      employeeCode: r.employeeCode,
      fullName: r.fullName,
      department: r.department,
      leaveType: r.leaveType,
      startDate: r.startDate,
      endDate: r.endDate,
      startHalf: r.startHalf,
      endHalf: r.endHalf,
      days: toDays(r.workingDays),
      daysInPeriod: split[i]!,
      status: r.status,
      note: r.note,
      attachment: r.hasAttachment,
      source: r.source,
    })),
  };
}

// ---------- files ----------

/** "payroll-2026-11" for one whole month, otherwise "payroll-2026-11-01_2026-12-15". Leave detail always uses the range. */
export function exportFileName(kind: ReportTable["kind"], p: Period, format: "xlsx" | "csv"): string {
  const base = kind === "payroll" ? "payroll" : "leave-detail";
  const month = p.from.slice(0, 7);
  const wholeMonth = p.from === `${month}-01` && p.to === monthBounds(month).end;
  const suffix = kind === "payroll" && wholeMonth ? month : `${p.from}_${p.to}`;
  return `${base}-${suffix}.${format}`;
}

const CONTENT_TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
} as const;

export async function exportReport(kind: ReportTable["kind"], p: Period, format: "xlsx" | "csv") {
  const table = kind === "payroll" ? await payrollReport(p) : await leaveDetailReport(p);
  const body = format === "xlsx" ? new Uint8Array(await toXlsx(table)) : new TextEncoder().encode(toCsv(table));
  return { body, contentType: CONTENT_TYPES[format], fileName: exportFileName(kind, p, format) };
}
