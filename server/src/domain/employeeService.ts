// Employees (spec 1.1): quick add with opening balances, inline edit, archive/restore,
// manual ledger adjustments. Employees are archived, never deleted (invariant 9).
import type { AdjustmentInput, EmployeeUpdateInput, employeeCreateSchema, EmployeeListQuery } from "@leave/shared";
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { codeOnlyEmail, revokePendingLinks } from "../auth/accounts";
import { revokeAllSessions } from "../auth/sessions";
import { db, type Db, type Tx } from "../db/client";
import { fromDays, toDays } from "../db/days";
import { department, employee, leaveType, user } from "../db/schema";
import { writeAudit } from "./audit";
import { DomainError, isUniqueViolation, notFound } from "./errors";
import { insertLedgerEntry, ledgerByType, loadBalances } from "./ledgerService";
import { listLeaves } from "./leaveService";
import { todayIso } from "./today";

type Conn = Db | Tx;
type EmployeeRow = typeof employee.$inferSelect;

/** Maps unique-index clashes to the i18n codes the inline editor shows. */
function rethrowUnique(err: unknown): never {
  if (isUniqueViolation(err, "employee_code_unique")) throw new DomainError("employees.errors.duplicateCode", 409);
  if (isUniqueViolation(err, "employee_email_unique") || isUniqueViolation(err, "user_email_unique")) {
    throw new DomainError("employees.errors.emailInUse", 409);
  }
  throw err;
}

async function assertDepartment(conn: Conn, departmentId: string) {
  const [d] = await conn.select({ id: department.id }).from(department).where(eq(department.id, departmentId));
  if (!d) throw new DomainError("employees.errors.unknownDepartment", 422);
}

async function assertLeaveTypes(conn: Conn, ids: readonly string[]) {
  if (ids.length === 0) return;
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw new DomainError("employees.errors.duplicateOpening", 400);
  const found = await conn.select({ id: leaveType.id }).from(leaveType).where(inArray(leaveType.id, unique));
  if (found.length !== unique.length) throw new DomainError("ledger.errors.unknownLeaveType", 422);
}

const employeeColumns = {
  id: employee.id,
  fullName: employee.fullName,
  employeeCode: employee.employeeCode,
  email: employee.email,
  jobTitle: employee.jobTitle,
  departmentId: employee.departmentId,
  departmentName: department.name,
  hireDate: employee.hireDate,
  endDate: employee.endDate,
  workDaysOverride: employee.workDaysOverride,
  status: employee.status,
  portalAccess: employee.portalAccess,
  hasLogin: sql<boolean>`${user.id} is not null`,
  annualAllowanceOverride: employee.annualAllowanceOverride,
};

function selectEmployees(conn: Conn) {
  return conn
    .select(employeeColumns)
    .from(employee)
    .innerJoin(department, eq(department.id, employee.departmentId))
    .leftJoin(user, eq(user.employeeId, employee.id));
}

const mapEmployee = (r: Awaited<ReturnType<ReturnType<typeof selectEmployees>["execute"]>>[number]) => ({
  ...r,
  annualAllowanceOverride: r.annualAllowanceOverride === null ? null : toDays(r.annualAllowanceOverride),
});

/** Employee list with balances per deducting type at today: three queries, no N+1. */
export async function listEmployees(q: { status: NonNullable<EmployeeListQuery["status"]> }) {
  const rows = await selectEmployees(db)
    .where(q.status === "all" ? undefined : eq(employee.status, q.status))
    .orderBy(asc(employee.fullName));
  const balances = await loadBalances(db, q.status === "all" ? undefined : rows.map((r) => r.id));
  return rows.map((r) => ({ ...mapEmployee(r), balances: balances.get(r.id) ?? {} }));
}

async function loadEmployeeView(conn: Conn, id: string) {
  const [row] = await selectEmployees(conn).where(eq(employee.id, id)).limit(1);
  if (!row) throw notFound();
  const balances = await loadBalances(conn, [id]);
  return { ...mapEmployee(row), balances: balances.get(id) ?? {} };
}

export async function getEmployeeDetail(id: string) {
  const emp = await loadEmployeeView(db, id);
  const { balances, ...employeeFields } = emp;
  return {
    employee: employeeFields,
    balances,
    ledger: await ledgerByType(db, id),
    leaves: await listLeaves({ employeeId: id }, "desc"),
  };
}

const auditView = (e: EmployeeRow) => ({
  fullName: e.fullName,
  employeeCode: e.employeeCode,
  email: e.email,
  jobTitle: e.jobTitle,
  departmentId: e.departmentId,
  hireDate: e.hireDate,
  endDate: e.endDate,
  annualAllowanceOverride: e.annualAllowanceOverride,
  status: e.status,
  portalAccess: e.portalAccess,
});

/**
 * Quick add. Opening balances are dated today, or the hire date for future hires, so they are
 * part of the balance from the employee's first day (interpretation; the spec only says
 * "set once at employee creation").
 */
export async function createEmployee(input: z.infer<typeof employeeCreateSchema>, actor: string) {
  try {
    return await db.transaction(async (tx) => {
      await assertDepartment(tx, input.departmentId);
      const openings = input.openingBalances.filter((o) => o.days !== 0);
      await assertLeaveTypes(tx, openings.map((o) => o.leaveTypeId));

      const [created] = await tx
        .insert(employee)
        .values({
          fullName: input.fullName,
          departmentId: input.departmentId,
          hireDate: input.hireDate,
          email: input.email ?? null,
          employeeCode: input.employeeCode,
          jobTitle: input.jobTitle,
          endDate: input.endDate ?? null,
          annualAllowanceOverride: input.annualAllowanceOverride == null ? null : fromDays(input.annualAllowanceOverride),
          status: "active",
        })
        .returning();
      const emp = created!;

      const today = todayIso();
      const effectiveDate = emp.hireDate <= today ? today : emp.hireDate;
      for (const o of openings) {
        await insertLedgerEntry(tx, {
          employeeId: emp.id,
          leaveTypeId: o.leaveTypeId,
          entryType: "opening",
          days: o.days,
          effectiveDate,
          periodKey: "opening", // unique key: one opening per employee and type
        });
      }
      await writeAudit(tx, {
        entity: "employee",
        entityId: emp.id,
        action: "employee.create",
        actor,
        after: { ...auditView(emp), openingBalances: openings },
      });
      return loadEmployeeView(tx, emp.id);
    });
  } catch (err) {
    rethrowUnique(err);
  }
}

export async function updateEmployee(id: string, input: EmployeeUpdateInput, actor: string) {
  let linksToRevoke: string | null = null;
  try {
    const result = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(employee).where(eq(employee.id, id)).for("update");
      if (!before) throw notFound();
      if (input.departmentId) await assertDepartment(tx, input.departmentId);

      const { annualAllowanceOverride, employeeCode, ...plain } = input;
      const next: Partial<typeof employee.$inferInsert> = {
        ...plain,
        ...(annualAllowanceOverride !== undefined
          ? { annualAllowanceOverride: annualAllowanceOverride === null ? null : fromDays(annualAllowanceOverride) }
          : {}),
        ...(employeeCode !== undefined ? { employeeCode: employeeCode || null } : {}),
      };
      const hireDate = input.hireDate ?? before.hireDate;
      const endDate = input.endDate !== undefined ? input.endDate : before.endDate;
      if (endDate && endDate < hireDate) throw new DomainError("employees.errors.endBeforeHire", 400);

      const [after] = await tx.update(employee).set(next).where(eq(employee.id, id)).returning();

      // Keep the login in step: its email follows the employee email (or the code-only login).
      const [login] = await tx.select({ id: user.id, email: user.email, name: user.name }).from(user).where(eq(user.employeeId, id));
      if (login) {
        const loginEmail = after!.email
          ? after!.email.toLowerCase()
          : after!.employeeCode
            ? codeOnlyEmail(after!.employeeCode)
            : null;
        if (!loginEmail) throw new DomainError("employees.errors.noLoginIdentifier", 400);
        if (loginEmail !== login.email || after!.fullName !== login.name) {
          await tx.update(user).set({ email: loginEmail, name: after!.fullName }).where(eq(user.id, login.id));
        }
        if (loginEmail !== login.email) linksToRevoke = login.id;
      }

      await writeAudit(tx, {
        entity: "employee",
        entityId: id,
        action: "employee.update",
        actor,
        before: auditView(before),
        after: auditView(after!),
      });
      return loadEmployeeView(tx, id);
    });
    // An invite or reset link sent to the old address must not stay usable.
    if (linksToRevoke) await revokePendingLinks(linksToRevoke);
    return result;
  } catch (err) {
    rethrowUnique(err);
  }
}

/** Archive cuts portal access immediately: sessions and pending links are revoked. */
export async function archiveEmployee(id: string, actor: string) {
  const result = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(employee).where(eq(employee.id, id)).for("update");
    if (!before) throw notFound();
    if (before.status === "archived") throw new DomainError("employees.errors.alreadyArchived", 409);
    const [after] = await tx
      .update(employee)
      .set({ status: "archived", portalAccess: false })
      .where(eq(employee.id, id))
      .returning();
    await writeAudit(tx, {
      entity: "employee",
      entityId: id,
      action: "employee.archive",
      actor,
      before: auditView(before),
      after: auditView(after!),
    });
    return loadEmployeeView(tx, id);
  });
  const [login] = await db.select({ id: user.id }).from(user).where(eq(user.employeeId, id));
  if (login) {
    await revokeAllSessions(login.id);
    await revokePendingLinks(login.id);
  }
  return result;
}

/** Restore makes the employee active again; portal access stays off until re-enabled. */
export async function restoreEmployee(id: string, actor: string) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(employee).where(eq(employee.id, id)).for("update");
    if (!before) throw notFound();
    if (before.status === "active") throw new DomainError("employees.errors.notArchived", 409);
    const [after] = await tx.update(employee).set({ status: "active" }).where(eq(employee.id, id)).returning();
    await writeAudit(tx, {
      entity: "employee",
      entityId: id,
      action: "employee.restore",
      actor,
      before: auditView(before),
      after: auditView(after!),
    });
    return loadEmployeeView(tx, id);
  });
}

/** Manual ± adjustment with a mandatory note: a new ledger row, never an overwrite. */
export async function addAdjustment(employeeId: string, input: AdjustmentInput, actor: string) {
  return db.transaction(async (tx) => {
    const [emp] = await tx.select({ id: employee.id }).from(employee).where(eq(employee.id, employeeId));
    if (!emp) throw notFound();
    await assertLeaveTypes(tx, [input.leaveTypeId]);
    const entry = await insertLedgerEntry(tx, {
      employeeId,
      leaveTypeId: input.leaveTypeId,
      entryType: "adjustment",
      days: input.days,
      effectiveDate: input.effectiveDate,
      note: input.note,
    });
    await writeAudit(tx, {
      entity: "ledger_entry",
      entityId: entry.id,
      action: "ledger.adjustment",
      actor,
      after: { employeeId, leaveTypeId: input.leaveTypeId, days: entry.days, effectiveDate: entry.effectiveDate, note: entry.note },
    });
    return {
      entry: {
        id: entry.id,
        entryType: entry.entryType,
        days: toDays(entry.days),
        effectiveDate: entry.effectiveDate,
        note: entry.note,
        leaveRequestId: entry.leaveRequestId,
        createdAt: entry.createdAt.toISOString(),
      },
      balances: (await loadBalances(tx, [employeeId])).get(employeeId) ?? {},
    };
  });
}
