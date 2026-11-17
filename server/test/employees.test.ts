// Step 3 verification: employees (spec 1.1), opening balances, adjustments, archive, list
// balances, reference data and departments.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "../src/auth/rateLimit";
import { db, sql as pg } from "../src/db/client";
import { auditLog, department, holiday, ledgerEntry, session, user, verification } from "../src/db/schema";
import { todayIso } from "../src/domain/today";
import { TestClient } from "./client";
import { resetDb } from "./db";
import { createLeaveTypes, json, signedInEmployee, signedInOperator } from "./operator";

type Types = Awaited<ReturnType<typeof createLeaveTypes>>;
type Balance = { balance: number; taken: number; pending: number; available: number };
type EmployeeView = { id: string; status: string; portalAccess: boolean; hasLogin: boolean; balances: Record<string, Balance> };

let op: TestClient;
let types: Types;
let deptId: string;

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  op = await signedInOperator();
  types = await createLeaveTypes();
  const [d] = await db.insert(department).values({ name: "Ops" }).returning();
  deptId = d!.id;
});

afterAll(async () => {
  await pg.end();
});

async function addEmployee(body: Record<string, unknown> = {}): Promise<EmployeeView> {
  const res = await op.post("/api/operator/employees", { fullName: "Lea Martin", departmentId: deptId, hireDate: "2024-01-01", ...body });
  expect(res.status).toBe(201);
  return json<EmployeeView>(res);
}

describe("create", () => {
  it("creates the employee with one opening entry per non-zero balance, in one transaction", async () => {
    const emp = await addEmployee({
      employeeCode: "E-1",
      email: "Lea@Test.local",
      openingBalances: [
        { leaveTypeId: types.paid.id, days: 12.5 },
        { leaveTypeId: types.comp.id, days: 0 },
      ],
    });
    expect(emp).toMatchObject({ status: "active", portalAccess: false, hasLogin: false });
    expect(emp.balances[types.paid.id]).toEqual({ balance: 12.5, taken: 0, pending: 0, available: 12.5 });
    expect(emp.balances[types.comp.id]).toEqual({ balance: 0, taken: 0, pending: 0, available: 0 });

    const entries = await db.select().from(ledgerEntry).where(eq(ledgerEntry.employeeId, emp.id));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entryType: "opening", days: "12.5", effectiveDate: todayIso(), periodKey: "opening" });

    const audits = await db.select().from(auditLog).where(and(eq(auditLog.entity, "employee"), eq(auditLog.entityId, emp.id)));
    expect(audits.map((a) => a.action)).toEqual(["employee.create"]);
  });

  it("a future hire's opening balance is dated on the hire date", async () => {
    const emp = await addEmployee({ hireDate: "2099-01-04", openingBalances: [{ leaveTypeId: types.paid.id, days: 3 }] });
    const [entry] = await db.select().from(ledgerEntry).where(eq(ledgerEntry.employeeId, emp.id));
    expect(entry!.effectiveDate).toBe("2099-01-04");
  });

  it("409 on duplicate code or email; nothing half-written", async () => {
    await addEmployee({ employeeCode: "E-1", email: "lea@test.local" });
    const code = await op.post("/api/operator/employees", {
      fullName: "Other",
      departmentId: deptId,
      hireDate: "2024-01-01",
      employeeCode: "E-1",
      openingBalances: [{ leaveTypeId: types.paid.id, days: 5 }],
    });
    expect(code.status).toBe(409);
    expect(await code.json()).toEqual({ code: "employees.errors.duplicateCode" });
    const email = await op.post("/api/operator/employees", { fullName: "Other", departmentId: deptId, hireDate: "2024-01-01", email: "LEA@test.local" });
    expect(email.status).toBe(409);
    expect(await email.json()).toEqual({ code: "employees.errors.emailInUse" });
    expect(await db.select().from(ledgerEntry)).toHaveLength(0);
  });

  it("validates with i18n keys", async () => {
    const res = await op.post("/api/operator/employees", { fullName: "", departmentId: deptId, hireDate: "2024-02-30" });
    expect(res.status).toBe(400);
    const body = await json<{ code: string; params: { issues: { path: string; message: string }[] } }>(res);
    expect(body.code).toBe("errors.validation");
    expect(body.params.issues.map((i) => i.message)).toEqual(expect.arrayContaining(["errors.required", "errors.invalidDate"]));
  });
});

describe("list balances", () => {
  it("balance / taken / pending / available per deducting type", async () => {
    const emp = await addEmployee({ openingBalances: [{ leaveTypeId: types.paid.id, days: 20 }] });
    const other = await addEmployee({ fullName: "Zoe Other" });
    const leave = (body: Record<string, unknown>) =>
      op.post("/api/operator/leaves", { employeeId: emp.id, leaveTypeId: types.paid.id, ...body });
    expect((await leave({ startDate: "2025-03-03", endDate: "2025-03-07", status: "approved" })).status).toBe(201);
    expect((await leave({ startDate: "2025-04-07", endDate: "2025-04-08", status: "pending" })).status).toBe(201);
    expect((await leave({ startDate: "2025-05-05", endDate: "2025-05-05", leaveTypeId: types.unpaid.id, status: "approved" })).status).toBe(201);

    const rows = await json<EmployeeView[]>(await op.get("/api/operator/employees"));
    expect(rows.map((r) => r.id)).toEqual([emp.id, other.id]);
    expect(rows[0]!.balances).toEqual({
      [types.paid.id]: { balance: 15, taken: 5, pending: 2, available: 13 },
      [types.comp.id]: { balance: 0, taken: 0, pending: 0, available: 0 },
    });
    expect(rows[1]!.balances[types.paid.id]).toEqual({ balance: 0, taken: 0, pending: 0, available: 0 });
  });
});

describe("detail, adjustments and ledger", () => {
  it("adjustment requires a note and appears in the ledger with a running balance", async () => {
    const emp = await addEmployee({ openingBalances: [{ leaveTypeId: types.paid.id, days: 10 }] });
    const noNote = await op.post(`/api/operator/employees/${emp.id}/adjustments`, {
      leaveTypeId: types.paid.id,
      days: 2,
      effectiveDate: "2025-01-15",
      note: "  ",
    });
    expect(noNote.status).toBe(400);
    expect(JSON.stringify(await noNote.json())).toContain("ledger.errors.noteRequired");

    const ok = await op.post(`/api/operator/employees/${emp.id}/adjustments`, {
      leaveTypeId: types.paid.id,
      days: -1.5,
      effectiveDate: "2025-01-15",
      note: "Correction",
    });
    expect(ok.status).toBe(201);
    expect((await json<{ balances: Record<string, Balance> }>(ok)).balances[types.paid.id]!.balance).toBe(8.5);

    const detail = await json<{
      employee: { id: string };
      ledger: Record<string, { entryType: string; days: number; note: string | null; runningBalance: number }[]>;
      leaves: unknown[];
    }>(await op.get(`/api/operator/employees/${emp.id}`));
    expect(detail.employee.id).toBe(emp.id);
    expect(detail.ledger[types.paid.id]!.map((l) => [l.entryType, l.days, l.note, l.runningBalance])).toEqual([
      ["adjustment", -1.5, "Correction", -1.5],
      ["opening", 10, null, 8.5],
    ]);
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, "ledger.adjustment"));
    expect(audits).toHaveLength(1);
  });

  it("detail lists leaves newest first; unknown id is 404", async () => {
    const emp = await addEmployee();
    for (const d of ["2025-03-03", "2025-05-05"]) {
      await op.post("/api/operator/leaves", { employeeId: emp.id, leaveTypeId: types.unpaid.id, startDate: d, endDate: d });
    }
    const detail = await json<{ leaves: { startDate: string }[] }>(await op.get(`/api/operator/employees/${emp.id}`));
    expect(detail.leaves.map((l) => l.startDate)).toEqual(["2025-05-05", "2025-03-03"]);
    expect((await op.get("/api/operator/employees/00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});

describe("edit, archive, restore", () => {
  it("PATCH edits inline with audit; an email change updates the login and revokes pending links", async () => {
    const emp = await addEmployee({ employeeCode: "E-9", email: "old@test.local" });
    await signedInEmployee(op, emp.id);
    const [u] = await db.select().from(user).where(eq(user.employeeId, emp.id));
    await db.insert(verification).values({ id: "v1", identifier: "reset-password:x", value: u!.id, expiresAt: new Date(Date.now() + 60_000) });

    const res = await op.patch(`/api/operator/employees/${emp.id}`, { email: "New@Test.local", jobTitle: "Analyst" });
    expect(res.status).toBe(200);
    const [after] = await db.select().from(user).where(eq(user.employeeId, emp.id));
    expect(after!.email).toBe("new@test.local");
    expect(await db.select().from(verification).where(eq(verification.value, u!.id))).toHaveLength(0);
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, "employee.update"));
    expect(audits).toHaveLength(1);

    const other = await addEmployee({ fullName: "B", email: "b@test.local" });
    const clash = await op.patch(`/api/operator/employees/${other.id}`, { email: "new@test.local" });
    expect(clash.status).toBe(409);
  });

  it("archive revokes the employee's sessions and cuts portal access; restore keeps access off", async () => {
    const emp = await addEmployee({ employeeCode: "E-5" });
    const portal = await signedInEmployee(op, emp.id);
    expect((await portal.get("/api/me/profile")).status).toBe(200);
    const [u] = await db.select().from(user).where(eq(user.employeeId, emp.id));
    expect(await db.select().from(session).where(eq(session.userId, u!.id))).toHaveLength(1);

    const res = await op.post(`/api/operator/employees/${emp.id}/archive`);
    expect(res.status).toBe(200);
    expect(await json<EmployeeView>(res)).toMatchObject({ status: "archived", portalAccess: false });
    expect(await db.select().from(session).where(eq(session.userId, u!.id))).toHaveLength(0);
    expect((await portal.get("/api/me/profile")).status).toBe(401);
    expect((await op.post(`/api/operator/employees/${emp.id}/archive`)).status).toBe(409);

    expect(await json<EmployeeView[]>(await op.get("/api/operator/employees"))).toHaveLength(0);
    expect(await json<EmployeeView[]>(await op.get("/api/operator/employees?status=archived"))).toHaveLength(1);

    const restored = await op.post(`/api/operator/employees/${emp.id}/restore`);
    expect(await json<EmployeeView>(restored)).toMatchObject({ status: "active", portalAccess: false });
    const actions = (await db.select().from(auditLog).where(eq(auditLog.entityId, emp.id))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["employee.archive", "employee.restore"]));
  });

  it("operator routes refuse employees and anonymous callers", async () => {
    const emp = await addEmployee({ employeeCode: "E-6" });
    const portal = await signedInEmployee(op, emp.id);
    expect((await portal.get("/api/operator/employees")).status).toBe(403);
    expect((await new TestClient().get("/api/operator/reference")).status).toBe(401);
  });
});

describe("reference and departments", () => {
  it("GET /reference returns settings, active types, departments and holidays in range", async () => {
    await db.insert(holiday).values([
      { date: "2025-01-01", name: "New Year" },
      { date: "2025-05-01", name: "Labour Day", isHalfDay: true },
      { date: "2026-01-01", name: "New Year" },
    ]);
    const res = await op.get("/api/operator/reference?from=2025-01-01&to=2025-12-31");
    expect(res.status).toBe(200);
    const body = await json<{
      workDays: number;
      settings: Record<string, unknown>;
      leaveTypes: { code: string }[];
      departments: { name: string }[];
      holidays: unknown[];
    }>(res);
    expect(body.workDays).toBe(31);
    expect(body.settings).toEqual({
      allowNegative: false,
      negativeLimitDays: 0,
      defaultSaveStatus: "approved",
      locale: "en-GB",
      leaveYearStartMonth: 1,
    });
    expect(body.leaveTypes.map((t) => t.code)).toEqual(["paid", "comp_rest", "sick", "unpaid"]);
    expect(body.departments.map((d) => d.name)).toEqual(["Ops"]);
    expect(body.holidays).toEqual([
      { date: "2025-01-01", name: "New Year", isHalfDay: false },
      { date: "2025-05-01", name: "Labour Day", isHalfDay: true },
    ]);
  });

  it("POST /departments creates with audit; 409 on a duplicate name", async () => {
    const res = await op.post("/api/operator/departments", { name: "Sales" });
    expect(res.status).toBe(201);
    const created = await json<{ id: string; name: string }>(res);
    expect(created.name).toBe("Sales");
    const dup = await op.post("/api/operator/departments", { name: "Sales" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ code: "departments.errors.duplicate" });
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "department.create"))).toHaveLength(1);
  });
});
