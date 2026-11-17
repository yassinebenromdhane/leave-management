// Reference data for the operator drawer: lets the browser run shared workingDays() locally for
// the live "4.5 working days" preview, with the same inputs the server uses.
import type { DepartmentInput, ReferenceQuery } from "@leave/shared";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "../db/client";
import { toDays } from "../db/days";
import { department, holiday, leaveType } from "../db/schema";
import { writeAudit } from "./audit";
import { loadSettings } from "./conflictChecker";
import { DomainError, isUniqueViolation } from "./errors";

export async function getReference(q: ReferenceQuery) {
  const settings = await loadSettings(db);
  const types = await db
    .select({
      id: leaveType.id,
      code: leaveType.code,
      name: leaveType.name,
      color: leaveType.color,
      isPaid: leaveType.isPaid,
      deductsBalance: leaveType.deductsBalance,
      dayCountMode: leaveType.dayCountMode,
      requiresAttachment: leaveType.requiresAttachment,
      defaultSaveStatus: leaveType.defaultSaveStatus,
      sortOrder: leaveType.sortOrder,
    })
    .from(leaveType)
    .where(eq(leaveType.isActive, true))
    .orderBy(asc(leaveType.sortOrder), asc(leaveType.name));
  const departments = await db
    .select({ id: department.id, name: department.name, minStaffing: department.minStaffing, sortOrder: department.sortOrder })
    .from(department)
    .orderBy(asc(department.sortOrder), asc(department.name));
  const holidays = await db
    .select({ date: holiday.date, name: holiday.name, isHalfDay: holiday.isHalfDay })
    .from(holiday)
    .where(and(q.from ? gte(holiday.date, q.from) : undefined, q.to ? lte(holiday.date, q.to) : undefined))
    .orderBy(asc(holiday.date));

  return {
    workDays: settings.workDays,
    settings: {
      allowNegative: settings.allowNegative,
      negativeLimitDays: toDays(settings.negativeLimitDays),
      defaultSaveStatus: settings.defaultSaveStatus,
      locale: settings.locale,
      leaveYearStartMonth: settings.leaveYearStartMonth,
    },
    leaveTypes: types,
    departments,
    holidays,
  };
}

export async function createDepartment(input: DepartmentInput, actor: string) {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(department)
        .values({ name: input.name, minStaffing: input.minStaffing ?? null })
        .returning({ id: department.id, name: department.name, minStaffing: department.minStaffing, sortOrder: department.sortOrder });
      await writeAudit(tx, { entity: "department", entityId: row!.id, action: "department.create", actor, after: row });
      return row!;
    });
  } catch (err) {
    if (isUniqueViolation(err, "department_name_unique")) throw new DomainError("departments.errors.duplicate", 409);
    throw err;
  }
}
