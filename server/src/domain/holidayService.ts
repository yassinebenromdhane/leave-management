// Public holidays (spec 1.5) and spec 4.2 rule 8.
// A holiday change is saved immediately and answers with `affectedLeaves`: the Pending leaves and
// the Approved leaves not yet over that include the old or new date AND whose day count changes
// against the new holiday set. Recalculation is a separate confirm step (recalculateHolidayLeaves),
// one transaction per leave, reusing leaveService's rule-5 logic.
import { workingDays, type HolidayUpdateInput, type holidayCreateSchema } from "@leave/shared";
import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import type { z } from "zod";
import { db, type Db, type Tx } from "../db/client";
import { toDays } from "../db/days";
import { employee, holiday, leaveRequest, leaveType } from "../db/schema";
import { writeAudit } from "./audit";
import { loadHolidays, loadSettings } from "./conflictChecker";
import { DomainError, isUniqueViolation, notFound } from "./errors";
import { recalculateLeaveDays } from "./leaveService";
import { todayIso } from "./today";

type Conn = Db | Tx;
type HolidayRow = typeof holiday.$inferSelect;

const holidayView = (h: HolidayRow) => ({
  id: h.id,
  date: h.date,
  name: h.name,
  isHalfDay: h.isHalfDay,
  isConfirmed: h.isConfirmed,
  source: h.source,
});
export type HolidayView = ReturnType<typeof holidayView>;

export async function listHolidays(year: number): Promise<HolidayView[]> {
  const rows = await db
    .select()
    .from(holiday)
    .where(and(gte(holiday.date, `${year}-01-01`), lte(holiday.date, `${year}-12-31`)))
    .orderBy(asc(holiday.date));
  return rows.map(holidayView);
}

export type AffectedLeave = {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  status: "pending" | "approved";
  oldDays: number;
  newDays: number;
};

/** Rule 8: leaves that include one of `dates` and whose day count differs from the snapshot. */
export async function findAffectedLeaves(conn: Conn, dates: readonly string[]): Promise<AffectedLeave[]> {
  if (dates.length === 0) return [];
  const today = todayIso();
  const rows = await conn
    .select({
      id: leaveRequest.id,
      employeeId: leaveRequest.employeeId,
      employeeName: employee.fullName,
      workDaysOverride: employee.workDaysOverride,
      leaveTypeName: leaveType.name,
      mode: leaveType.dayCountMode,
      startDate: leaveRequest.startDate,
      endDate: leaveRequest.endDate,
      startHalf: leaveRequest.startHalf,
      endHalf: leaveRequest.endHalf,
      status: leaveRequest.status,
      workingDays: leaveRequest.workingDays,
    })
    .from(leaveRequest)
    .innerJoin(employee, eq(employee.id, leaveRequest.employeeId))
    .innerJoin(leaveType, eq(leaveType.id, leaveRequest.leaveTypeId))
    .where(
      and(
        isNull(leaveRequest.deletedAt),
        or(eq(leaveRequest.status, "pending"), and(eq(leaveRequest.status, "approved"), gte(leaveRequest.endDate, today))),
        or(...dates.map((d) => and(lte(leaveRequest.startDate, d), gte(leaveRequest.endDate, d)))),
      ),
    )
    .orderBy(asc(leaveRequest.startDate), asc(employee.fullName));
  if (rows.length === 0) return [];

  const settings = await loadSettings(conn);
  const from = rows.reduce((m, r) => (r.startDate < m ? r.startDate : m), rows[0]!.startDate);
  const to = rows.reduce((m, r) => (r.endDate > m ? r.endDate : m), rows[0]!.endDate);
  const holidays = await loadHolidays(conn, from, to);

  const out: AffectedLeave[] = [];
  for (const r of rows) {
    const newDays = workingDays({
      startDate: r.startDate,
      endDate: r.endDate,
      startHalf: r.startHalf,
      endHalf: r.endHalf,
      mode: r.mode,
      workDays: r.workDaysOverride ?? settings.workDays,
      holidays: holidays.filter((h) => h.date >= r.startDate && h.date <= r.endDate),
    }).days;
    const oldDays = toDays(r.workingDays);
    if (newDays === oldDays) continue;
    out.push({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      leaveTypeName: r.leaveTypeName,
      startDate: r.startDate,
      endDate: r.endDate,
      status: r.status as "pending" | "approved",
      oldDays,
      newDays,
    });
  }
  return out;
}

const duplicateDate = (err: unknown): never => {
  if (isUniqueViolation(err, "holiday_date_unique")) throw new DomainError("holidays.errors.duplicateDate", 409);
  throw err;
};

export async function createHoliday(input: z.output<typeof holidayCreateSchema>, actor: string) {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(holiday)
        .values({
          date: input.date,
          name: input.name,
          isHalfDay: input.isHalfDay,
          isConfirmed: input.isConfirmed,
          source: input.source,
        })
        .returning();
      const view = holidayView(row!);
      await writeAudit(tx, { entity: "holiday", entityId: view.id, action: "holiday.create", actor, after: view });
      return { holiday: view, affectedLeaves: await findAffectedLeaves(tx, [view.date]) };
    });
  } catch (err) {
    return duplicateDate(err);
  }
}

export async function updateHoliday(id: string, input: HolidayUpdateInput, actor: string) {
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(holiday).where(eq(holiday.id, id)).for("update");
      if (!before) throw notFound();
      const [after] = await tx.update(holiday).set(input).where(eq(holiday.id, id)).returning();
      const view = holidayView(after!);
      await writeAudit(tx, {
        entity: "holiday",
        entityId: id,
        action: "holiday.update",
        actor,
        before: holidayView(before),
        after: view,
      });
      // Renaming or confirming changes no day count; moving or toggling half-day does.
      const countChanged = before.date !== view.date || before.isHalfDay !== view.isHalfDay;
      const dates = countChanged ? [...new Set([before.date, view.date])] : [];
      return { holiday: view, affectedLeaves: await findAffectedLeaves(tx, dates) };
    });
  } catch (err) {
    return duplicateDate(err);
  }
}

export async function deleteHoliday(id: string, actor: string) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(holiday).where(eq(holiday.id, id)).for("update");
    if (!before) throw notFound();
    await tx.delete(holiday).where(eq(holiday.id, id));
    await writeAudit(tx, { entity: "holiday", entityId: id, action: "holiday.delete", actor, before: holidayView(before) });
    return { ok: true as const, affectedLeaves: await findAffectedLeaves(tx, [before.date]) };
  });
}

/** Confirm step of rule 8. Each leave is its own transaction (one failure never undoes the rest). */
export async function recalculateHolidayLeaves(leaveIds: readonly string[], actor: string) {
  let updated = 0;
  let unchanged = 0;
  const skipped: { id: string; code: string }[] = [];
  for (const id of new Set(leaveIds)) {
    try {
      const r = await recalculateLeaveDays(id, actor);
      if ("code" in r) skipped.push({ id, code: r.code });
      else if (r.result === "updated") updated++;
      else unchanged++;
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      skipped.push({ id, code: err.code });
    }
  }
  return { updated, unchanged, skipped };
}
