// Settings (spec 1.5, four tabs): company, departments, leave types + policies, public holidays.
// Every mutation is one transaction with its audit_log row. Leave types are never deleted
// (deactivate instead) and changing a type never rewrites past ledger entries.
import {
  leaveYearStartFor,
  type CompanySettingsUpdateInput,
  type DepartmentUpdateInput,
  type LeaveTypeUpdateInput,
  type leavePolicyInputSchema,
  type leaveTypeCreateSchema,
} from "@leave/shared";
import { asc, count, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { db, type Db, type Tx } from "../db/client";
import { fromDays, toDays } from "../db/days";
import { companySettings, department, employee, leavePolicy, leaveType } from "../db/schema";
import { writeAudit } from "./audit";
import { loadSettings } from "./conflictChecker";
import { DomainError, isForeignKeyViolation, isUniqueViolation, notFound } from "./errors";
import { listHolidays } from "./holidayService";
import { todayIso } from "./today";

type Conn = Db | Tx;

// ---------- views ----------

const companyView = (s: typeof companySettings.$inferSelect) => ({
  name: s.name,
  countryCode: s.countryCode,
  workDays: s.workDays,
  leaveYearStartMonth: s.leaveYearStartMonth,
  allowNegative: s.allowNegative,
  negativeLimitDays: toDays(s.negativeLimitDays),
  defaultSaveStatus: s.defaultSaveStatus,
  locale: s.locale,
  teamVisibility: s.teamVisibility,
});
export type CompanyView = ReturnType<typeof companyView>;

const leaveTypeView = (t: typeof leaveType.$inferSelect) => ({
  id: t.id,
  code: t.code,
  name: t.name,
  color: t.color,
  isPaid: t.isPaid,
  deductsBalance: t.deductsBalance,
  dayCountMode: t.dayCountMode,
  requiresAttachment: t.requiresAttachment,
  annualCapDays: t.annualCapDays === null ? null : toDays(t.annualCapDays),
  defaultSaveStatus: t.defaultSaveStatus,
  sortOrder: t.sortOrder,
  isActive: t.isActive,
  createdAt: t.createdAt.toISOString(),
});

const policyView = (p: typeof leavePolicy.$inferSelect) => ({
  id: p.id,
  leaveTypeId: p.leaveTypeId,
  accrualMode: p.accrualMode,
  rateDays: toDays(p.rateDays),
  prorateHireMonth: p.prorateHireMonth,
  carryoverCapDays: p.carryoverCapDays === null ? null : toDays(p.carryoverCapDays),
  carryoverExpiryMonthDay: p.carryoverExpiryMonthDay,
  effectiveFrom: p.effectiveFrom,
  createdAt: p.createdAt.toISOString(),
});
export type PolicyView = ReturnType<typeof policyView>;

const departmentColumns = {
  id: department.id,
  name: department.name,
  minStaffing: department.minStaffing,
  sortOrder: department.sortOrder,
  // Qualified by hand: in a join-less select Drizzle renders columns unqualified, which would make
  // the correlated subquery compare employee columns with themselves.
  employeeCount: sql<number>`(select count(*)::int from "employee" e where e.department_id = "department"."id")`,
  activeEmployeeCount: sql<number>`(select count(*)::int from "employee" e where e.department_id = "department"."id" and e.status = 'active')`,
};

/** Current policy (latest effective_from <= today) and full history, oldest first, per leave type. */
async function policiesByType(conn: Conn, leaveTypeId?: string) {
  const rows = await conn
    .select()
    .from(leavePolicy)
    .where(leaveTypeId ? eq(leavePolicy.leaveTypeId, leaveTypeId) : undefined)
    .orderBy(asc(leavePolicy.leaveTypeId), asc(leavePolicy.effectiveFrom));
  const today = todayIso();
  const grouped = new Map<string, PolicyView[]>();
  for (const r of rows) {
    const list = grouped.get(r.leaveTypeId) ?? [];
    list.push(policyView(r));
    grouped.set(r.leaveTypeId, list);
  }
  return [...grouped].map(([typeId, history]) => ({
    leaveTypeId: typeId,
    current: history.filter((p) => p.effectiveFrom <= today).at(-1) ?? null,
    history,
  }));
}

export async function getSettings(year: number | undefined) {
  const settings = await loadSettings(db);
  const departments = await db.select(departmentColumns).from(department).orderBy(asc(department.sortOrder), asc(department.name));
  const types = await db.select().from(leaveType).orderBy(asc(leaveType.sortOrder), asc(leaveType.name));
  const y = year ?? Number(todayIso().slice(0, 4));
  return {
    company: companyView(settings),
    departments,
    leaveTypes: types.map(leaveTypeView),
    policies: await policiesByType(db),
    holidayYear: y,
    holidays: await listHolidays(y),
  };
}

// ---------- company ----------

export async function updateCompany(input: CompanySettingsUpdateInput, actor: string) {
  return db.transaction(async (tx) => {
    const before = await loadSettings(tx);
    const { negativeLimitDays, ...rest } = input;
    const [after] = await tx
      .update(companySettings)
      .set({ ...rest, ...(negativeLimitDays === undefined ? {} : { negativeLimitDays: fromDays(negativeLimitDays) }) })
      .where(eq(companySettings.id, 1))
      .returning();
    await writeAudit(tx, {
      entity: "company_settings",
      entityId: "1",
      action: "settings.company.update",
      actor,
      before: companyView(before),
      after: companyView(after!),
    });
    return companyView(after!);
  });
}

// ---------- departments ----------

export async function updateDepartment(id: string, input: DepartmentUpdateInput, actor: string) {
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(department).where(eq(department.id, id)).for("update");
      if (!before) throw notFound();
      const [after] = await tx.update(department).set(input).where(eq(department.id, id)).returning();
      await writeAudit(tx, { entity: "department", entityId: id, action: "department.update", actor, before, after });
      const [row] = await tx.select(departmentColumns).from(department).where(eq(department.id, id));
      return row!;
    });
  } catch (err) {
    if (isUniqueViolation(err, "department_name_unique")) throw new DomainError("departments.errors.duplicate", 409);
    throw err;
  }
}

/** Real delete of an empty lookup row. Any employee (active or archived) keeps it alive. */
export async function deleteDepartment(id: string, actor: string) {
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(department).where(eq(department.id, id)).for("update");
      if (!before) throw notFound();
      const [n] = await tx.select({ n: count() }).from(employee).where(eq(employee.departmentId, id));
      if ((n?.n ?? 0) > 0) throw new DomainError("departments.errors.notEmpty", 409, { count: n!.n });
      await tx.delete(department).where(eq(department.id, id));
      await writeAudit(tx, { entity: "department", entityId: id, action: "department.delete", actor, before });
      return { ok: true as const };
    });
  } catch (err) {
    if (isForeignKeyViolation(err)) throw new DomainError("departments.errors.notEmpty", 409);
    throw err;
  }
}

// ---------- leave types ----------

const capOf = (v: number | null | undefined) => (v === undefined ? undefined : v === null ? null : fromDays(v));

export async function createLeaveType(input: z.output<typeof leaveTypeCreateSchema>, actor: string) {
  return db.transaction(async (tx) => {
    let sortOrder = input.sortOrder;
    if (sortOrder === undefined) {
      const [m] = await tx.select({ max: sql<number | null>`max(${leaveType.sortOrder})` }).from(leaveType);
      sortOrder = (m?.max ?? -1) + 1;
    }
    const [row] = await tx
      .insert(leaveType)
      .values({
        name: input.name,
        color: input.color,
        isPaid: input.isPaid,
        deductsBalance: input.deductsBalance,
        dayCountMode: input.dayCountMode,
        requiresAttachment: input.requiresAttachment,
        annualCapDays: capOf(input.annualCapDays) ?? null,
        defaultSaveStatus: input.defaultSaveStatus,
        sortOrder,
        isActive: input.isActive,
      })
      .returning();
    const view = leaveTypeView(row!);
    await writeAudit(tx, { entity: "leave_type", entityId: view.id, action: "leave_type.create", actor, after: view });
    return view;
  });
}

/** dayCountMode / deductsBalance changes apply to future saves only; the ledger is never rewritten. */
export async function updateLeaveType(id: string, input: LeaveTypeUpdateInput, actor: string) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(leaveType).where(eq(leaveType.id, id)).for("update");
    if (!before) throw notFound();
    const { annualCapDays, ...rest } = input;
    const [after] = await tx
      .update(leaveType)
      .set({ ...rest, ...(annualCapDays === undefined ? {} : { annualCapDays: capOf(annualCapDays) }) })
      .where(eq(leaveType.id, id))
      .returning();
    const view = leaveTypeView(after!);
    await writeAudit(tx, {
      entity: "leave_type",
      entityId: id,
      action: "leave_type.update",
      actor,
      before: leaveTypeView(before),
      after: view,
    });
    return view;
  });
}

// ---------- policies ----------

/**
 * Spec 1.5: a rule change applies "from today" or "from the start of the leave year". It inserts a
 * NEW leave_policy row with that effective_from, so history stays intact; when a row already
 * exists for that exact date, its values are replaced (a same-day correction of the config row).
 */
export async function setPolicy(
  leaveTypeId: string,
  input: z.output<typeof leavePolicyInputSchema>,
  actor: string,
) {
  return db.transaction(async (tx) => {
    const [type] = await tx.select({ id: leaveType.id }).from(leaveType).where(eq(leaveType.id, leaveTypeId));
    if (!type) throw notFound();
    const settings = await loadSettings(tx);
    const today = todayIso();
    const effectiveFrom = input.applyFrom === "today" ? today : leaveYearStartFor(today, settings.leaveYearStartMonth);

    const values = {
      accrualMode: input.accrualMode,
      rateDays: fromDays(input.rateDays),
      prorateHireMonth: input.prorateHireMonth,
      carryoverCapDays: capOf(input.carryoverCapDays) ?? null,
      carryoverExpiryMonthDay: input.carryoverExpiryMonthDay,
    };
    const [existing] = await tx
      .select()
      .from(leavePolicy)
      .where(sql`${leavePolicy.leaveTypeId} = ${leaveTypeId} and ${leavePolicy.effectiveFrom} = ${effectiveFrom}`)
      .for("update");
    const [row] = await tx
      .insert(leavePolicy)
      .values({ leaveTypeId, effectiveFrom, ...values })
      .onConflictDoUpdate({ target: [leavePolicy.leaveTypeId, leavePolicy.effectiveFrom], set: values })
      .returning();
    await writeAudit(tx, {
      entity: "leave_policy",
      entityId: row!.id,
      action: existing ? "leave_policy.replace" : "leave_policy.create",
      actor,
      before: existing ? policyView(existing) : null,
      after: { ...policyView(row!), applyFrom: input.applyFrom },
    });
    const [policies] = await policiesByType(tx, leaveTypeId);
    return { policy: policyView(row!), ...policies! };
  });
}
