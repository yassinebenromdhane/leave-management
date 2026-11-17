// Step 3 verification: leave logging, status transitions and their ledger writes (spec 1.2, 1.3,
// 4.2 rules 4-5), blocking vs warning checks, per-employee serialization, soft delete + Undo.
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "../src/auth/rateLimit";
import { db, sql as pg } from "../src/db/client";
import { auditLog, companySettings, employee, holiday, leaveRequest, ledgerEntry } from "../src/db/schema";
import type { TestClient } from "./client";
import { createEmployee, resetDb } from "./db";
import { createLeaveTypes, json, signedInOperator } from "./operator";

type Types = Awaited<ReturnType<typeof createLeaveTypes>>;
type Leave = { id: string; status: string; workingDays: number; hasWarning: boolean; conflicts?: Conflicts };
type Conflicts = { blocking: { code: string }[]; warnings: { code: string }[] };

let op: TestClient;
let types: Types;
let emp: Awaited<ReturnType<typeof createEmployee>>;

// Mon 3 – Fri 7 March 2025: 5 working days, safely in the past for "today" balances.
const WEEK = { startDate: "2025-03-03", endDate: "2025-03-07" };

async function giveOpening(employeeId: string, leaveTypeId: string, days: string) {
  await db.insert(ledgerEntry).values({
    employeeId,
    leaveTypeId,
    entryType: "opening",
    days,
    effectiveDate: "2024-01-01",
    periodKey: "opening",
  });
}

async function createLeave(body: Record<string, unknown>) {
  return op.post("/api/operator/leaves", { employeeId: emp.id, leaveTypeId: types.paid.id, ...WEEK, ...body });
}

async function createOk(body: Record<string, unknown> = {}): Promise<Leave> {
  const res = await createLeave(body);
  expect(res.status).toBe(201);
  return json<Leave>(res);
}

const ledgerOf = (leaveRequestId: string) =>
  db.select().from(ledgerEntry).where(eq(ledgerEntry.leaveRequestId, leaveRequestId)).orderBy(asc(ledgerEntry.createdAt));

async function paidBalance(employeeId = emp.id) {
  const res = await op.get(`/api/operator/employees/${employeeId}`);
  const body = await json<{ balances: Record<string, { balance: number; taken: number; pending: number; available: number }> }>(res);
  return body.balances[types.paid.id]!;
}

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  op = await signedInOperator();
  types = await createLeaveTypes();
  emp = await createEmployee({ hireDate: "2024-01-01" });
  await giveOpening(emp.id, types.paid.id, "20.0");
});

afterAll(async () => {
  await pg.end();
});

describe("create", () => {
  it("stores the server's day count and an approved leave writes one leave entry", async () => {
    await db.insert(holiday).values({ date: "2025-03-05", name: "Test holiday" });
    const leave = await createOk({ status: "approved", workingDays: 99 });
    expect(leave.workingDays).toBe(4);
    const entries = await ledgerOf(leave.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entryType: "leave", days: "-4.0", effectiveDate: "2025-03-03", leaveTypeId: types.paid.id });
  });

  it("uses the company default status when none is given, and pending writes no ledger", async () => {
    await db.update(companySettings).set({ defaultSaveStatus: "pending" });
    const leave = await createOk();
    expect(leave.status).toBe("pending");
    expect(await ledgerOf(leave.id)).toHaveLength(0);
  });

  it("non-deducting types never touch the ledger", async () => {
    const leave = await createOk({ leaveTypeId: types.unpaid.id, status: "approved" });
    expect(await ledgerOf(leave.id)).toHaveLength(0);
  });
});

describe("status transitions (rule 4)", () => {
  it("approve writes exactly one leave entry of -working_days dated start", async () => {
    const leave = await createOk({ status: "pending" });
    const res = await op.post(`/api/operator/leaves/${leave.id}/status`, { status: "approved" });
    expect(res.status).toBe(200);
    expect((await json<Leave>(res)).status).toBe("approved");
    const entries = await ledgerOf(leave.id);
    expect(entries.map((e) => [e.entryType, e.days, e.effectiveDate])).toEqual([["leave", "-5.0", "2025-03-03"]]);
    const [row] = await db.select().from(leaveRequest).where(eq(leaveRequest.id, leave.id));
    expect(row!.decidedAt).not.toBeNull();
  });

  it("reject of a pending leave writes nothing and stores the reason", async () => {
    const leave = await createOk({ status: "pending" });
    const res = await op.post(`/api/operator/leaves/${leave.id}/status`, { status: "rejected", reason: "Busy week" });
    expect(res.status).toBe(200);
    expect(await ledgerOf(leave.id)).toHaveLength(0);
    const [row] = await db.select().from(leaveRequest).where(eq(leaveRequest.id, leave.id));
    expect(row).toMatchObject({ status: "rejected", rejectReason: "Busy week" });
  });

  it("cancel of an approved leave writes a linked reversal", async () => {
    const leave = await createOk({ status: "approved" });
    expect((await op.post(`/api/operator/leaves/${leave.id}/status`, { status: "cancelled" })).status).toBe(200);
    const entries = await ledgerOf(leave.id);
    expect(entries.map((e) => [e.entryType, e.days])).toEqual([
      ["leave", "-5.0"],
      ["reversal", "5.0"],
    ]);
    expect(entries[1]!.leaveRequestId).toBe(leave.id);
    expect((await paidBalance()).balance).toBe(20);
  });

  it("same status is 409; approved → pending (Undo of an approval) writes a reversal", async () => {
    const leave = await createOk({ status: "approved" });
    const same = await op.post(`/api/operator/leaves/${leave.id}/status`, { status: "approved" });
    expect(same.status).toBe(409);
    expect(await same.json()).toEqual({ code: "leave.errors.sameStatus" });
    const back = await op.post(`/api/operator/leaves/${leave.id}/status`, { status: "pending" });
    expect(back.status).toBe(200);
    expect((await ledgerOf(leave.id)).map((e) => e.entryType)).toEqual(["leave", "reversal"]);
    expect((await paidBalance()).balance).toBe(20);
  });

  it("approving re-runs blocking checks (422) and writes nothing when blocked", async () => {
    const leave = await createOk({ status: "pending" });
    // Balance drops below the leave after it was logged.
    await db.insert(ledgerEntry).values({
      employeeId: emp.id,
      leaveTypeId: types.paid.id,
      entryType: "adjustment",
      days: "-18.0",
      effectiveDate: "2024-06-01",
      note: "correction",
    });
    const res = await op.post(`/api/operator/leaves/${leave.id}/status`, { status: "approved" });
    expect(res.status).toBe(422);
    const body = await json<{ code: string; conflicts: Conflicts }>(res);
    expect(body.code).toBe("leave.errors.blocked");
    expect(body.conflicts.blocking.map((b) => b.code)).toEqual(["conflicts.negativeBalance"]);
    expect(await ledgerOf(leave.id)).toHaveLength(0);
  });

  it("bulk approve processes each id on its own", async () => {
    const a = await createOk({ status: "pending" });
    const b = await createOk({ status: "pending", startDate: "2025-04-07", endDate: "2025-04-07" });
    const approvedAlready = await createOk({ status: "approved", startDate: "2025-05-05", endDate: "2025-05-05" });
    const res = await op.post("/api/operator/leaves/bulk-status", { ids: [a.id, b.id, approvedAlready.id], status: "approved" });
    expect(res.status).toBe(200);
    expect((await json<{ results: unknown[] }>(res)).results).toEqual([
      { id: a.id, ok: true },
      { id: b.id, ok: true },
      { id: approvedAlready.id, ok: false, code: "leave.errors.sameStatus" },
    ]);
    expect(await ledgerOf(a.id)).toHaveLength(1);
    expect(await ledgerOf(b.id)).toHaveLength(1);
  });
});

describe("edit (rule 5)", () => {
  it("edit of approved dates = reversal of the old amount + new leave entry", async () => {
    const leave = await createOk({ status: "approved" });
    const res = await op.patch(`/api/operator/leaves/${leave.id}`, {
      leaveTypeId: types.paid.id,
      startDate: "2025-03-10",
      endDate: "2025-03-12",
    });
    expect(res.status).toBe(200);
    expect((await json<Leave>(res)).workingDays).toBe(3);
    const entries = await ledgerOf(leave.id);
    expect(entries.map((e) => [e.entryType, e.days, e.effectiveDate])).toEqual([
      ["leave", "-5.0", "2025-03-03"],
      ["reversal", "5.0", "2025-03-03"],
      ["leave", "-3.0", "2025-03-10"],
    ]);
    expect((await paidBalance()).balance).toBe(17);
  });

  it("a forced failure mid-transaction leaves nothing written", async () => {
    const leave = await createOk({ status: "approved" });
    await db.execute(sql`
      create or replace function test_fail_leave_update() returns trigger language plpgsql as $$
      begin
        if new.action = 'leave.update' then raise exception 'forced failure'; end if;
        return new;
      end $$`);
    await db.execute(sql`create trigger test_fail_leave_update before insert on audit_log
      for each row execute function test_fail_leave_update()`);
    try {
      const res = await op.patch(`/api/operator/leaves/${leave.id}`, {
        leaveTypeId: types.paid.id,
        startDate: "2025-03-10",
        endDate: "2025-03-12",
      });
      expect(res.status).toBe(500);
    } finally {
      await db.execute(sql`drop trigger if exists test_fail_leave_update on audit_log`);
      await db.execute(sql`drop function if exists test_fail_leave_update()`);
    }
    expect((await ledgerOf(leave.id)).map((e) => e.entryType)).toEqual(["leave"]);
    const [row] = await db.select().from(leaveRequest).where(eq(leaveRequest.id, leave.id));
    expect(row).toMatchObject({ startDate: "2025-03-03", workingDays: "5.0" });
  });

  it("type change on an approved leave moves the days between types", async () => {
    await giveOpening(emp.id, types.comp.id, "10.0");
    const leave = await createOk({ status: "approved" });
    const res = await op.patch(`/api/operator/leaves/${leave.id}`, { leaveTypeId: types.comp.id, ...WEEK });
    expect(res.status).toBe(200);
    const entries = await ledgerOf(leave.id);
    expect(entries.map((e) => [e.entryType, e.leaveTypeId, e.days])).toEqual([
      ["leave", types.paid.id, "-5.0"],
      ["reversal", types.paid.id, "5.0"],
      ["leave", types.comp.id, "-5.0"],
    ]);
    const detail = await json<{ balances: Record<string, { balance: number }> }>(await op.get(`/api/operator/employees/${emp.id}`));
    expect(detail.balances[types.paid.id]!.balance).toBe(20);
    expect(detail.balances[types.comp.id]!.balance).toBe(5);
  });

  it("edit checks exclude the leave itself (no self-overlap with its old dates)", async () => {
    const leave = await createOk({ status: "approved" });
    const res = await op.patch(`/api/operator/leaves/${leave.id}`, {
      leaveTypeId: types.paid.id,
      startDate: "2025-03-04",
      endDate: "2025-03-07",
      note: "shortened",
    });
    expect(res.status).toBe(200);
  });
});

describe("blocking checks (spec 1.3)", () => {
  it("self-overlap is 422, but a morning and an afternoon on the same date are allowed", async () => {
    await createOk({ status: "approved" });
    const clash = await createLeave({ startDate: "2025-03-07", endDate: "2025-03-10" });
    expect(clash.status).toBe(422);
    const body = await json<{ conflicts: Conflicts }>(clash);
    expect(body.conflicts.blocking.map((b) => b.code)).toEqual(["conflicts.selfOverlap"]);

    const day = { startDate: "2025-04-01", endDate: "2025-04-01" };
    await createOk({ ...day, startHalf: "am", endHalf: "am" });
    const pm = await createOk({ ...day, startHalf: "pm", endHalf: "pm" });
    expect(pm.workingDays).toBe(0.5);
    const again = await createLeave({ ...day, startHalf: "pm", endHalf: "pm" });
    expect(again.status).toBe(422);
  });

  it("zero working days is 422", async () => {
    const res = await createLeave({ startDate: "2025-03-08", endDate: "2025-03-09" });
    expect(res.status).toBe(422);
    expect((await json<{ conflicts: Conflicts }>(res)).conflicts.blocking.map((b) => b.code)).toEqual(["conflicts.zeroDays"]);
    expect(await db.select().from(leaveRequest)).toHaveLength(0);
  });

  it("outside the employment period is 422", async () => {
    const res = await createLeave({ startDate: "2023-12-29", endDate: "2024-01-02" });
    expect(res.status).toBe(422);
    const codes = (await json<{ conflicts: Conflicts }>(res)).conflicts.blocking.map((b) => b.code);
    expect(codes).toContain("conflicts.outsideEmployment");
  });

  it("negative balance is blocking when not allowed, a warning within the allowed limit", async () => {
    const poor = await createEmployee({ employeeCode: "EMP-002", email: "poor@test.local" });
    await giveOpening(poor.id, types.paid.id, "2.0");
    const body = { employeeId: poor.id, leaveTypeId: types.paid.id, ...WEEK, status: "approved" };

    const blocked = await op.post("/api/operator/leaves", body);
    expect(blocked.status).toBe(422);
    expect((await json<{ conflicts: Conflicts }>(blocked)).conflicts.blocking.map((b) => b.code)).toEqual([
      "conflicts.negativeBalance",
    ]);

    await db.update(companySettings).set({ allowNegative: true, negativeLimitDays: "2.0" });
    expect((await op.post("/api/operator/leaves", body)).status).toBe(422); // -3 is beyond the -2 limit

    await db.update(companySettings).set({ negativeLimitDays: "3.0" });
    const ok = await op.post("/api/operator/leaves", body);
    expect(ok.status).toBe(201);
    const leave = await json<Leave>(ok);
    expect(leave.hasWarning).toBe(true);
    expect(leave.conflicts!.warnings.map((w) => w.code)).toEqual(["conflicts.negativeBalance"]);
  });

  it("future approved leave already spends days: two future leaves cannot both use them", async () => {
    const future = { startDate: "2099-03-02", endDate: "2099-03-13" }; // 10 working days
    await createOk({ ...future, status: "approved" });
    const second = await createLeave({ startDate: "2099-04-06", endDate: "2099-04-17", status: "approved" });
    expect(second.status).toBe(201); // 20 - 10 - 10 = 0
    const third = await createLeave({ startDate: "2099-05-04", endDate: "2099-05-04", status: "pending" });
    expect(third.status).toBe(422);
  });

  it("a same-department colleague off is a warning that sets has_warning", async () => {
    const colleague = await createEmployee({
      fullName: "Sam Colleague",
      departmentId: emp.departmentId,
      employeeCode: "EMP-003",
      email: "sam@test.local",
    });
    await giveOpening(colleague.id, types.paid.id, "20.0");
    await op.post("/api/operator/leaves", { employeeId: colleague.id, leaveTypeId: types.paid.id, ...WEEK, status: "approved" });

    const leave = await createOk({ startDate: "2025-03-06", endDate: "2025-03-10" });
    expect(leave.hasWarning).toBe(true);
    const warning = leave.conflicts!.warnings[0] as { code: string; params: Record<string, unknown> };
    expect(warning.code).toBe("conflicts.colleaguesOff");
    expect(warning.params).toMatchObject({ count: 1, size: 2, people: [{ name: "Sam Colleague", start: WEEK.startDate, end: WEEK.endDate }] });
  });

  it("parallel creates of overlapping leaves for one employee: exactly one succeeds", async () => {
    const results = await Promise.all([
      createLeave({ status: "approved" }),
      createLeave({ status: "approved", startDate: "2025-03-05", endDate: "2025-03-11" }),
      createLeave({ status: "pending", startDate: "2025-03-07", endDate: "2025-03-07" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422, 422]);
    expect(await db.select().from(leaveRequest)).toHaveLength(1);
  });
});

describe("preview", () => {
  it("returns days, exclusions, balance after and conflicts without writing", async () => {
    await db.insert(holiday).values({ date: "2025-03-05", name: "Test holiday", isHalfDay: true });
    const res = await op.post("/api/operator/leaves/preview", {
      employeeId: emp.id,
      leaveTypeId: types.paid.id,
      startDate: "2025-03-03",
      endDate: "2025-03-10",
      endHalf: "am",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      days: 5,
      weekendDays: 2,
      holidayDays: 1,
      balance: { available: 20, after: 15 },
      conflicts: { blocking: [], warnings: [] },
    });
    expect(await db.select().from(leaveRequest)).toHaveLength(0);
  });

  it("for an edit, the leave's own consumption is given back before computing 'after'", async () => {
    const leave = await createOk({ status: "approved" });
    const res = await op.post("/api/operator/leaves/preview", {
      employeeId: emp.id,
      leaveTypeId: types.paid.id,
      ...WEEK,
      excludeLeaveId: leave.id,
    });
    const body = await json<{ balance: { available: number; after: number }; conflicts: Conflicts }>(res);
    expect(body.balance).toEqual({ available: 20, after: 15 });
    expect(body.conflicts.blocking).toEqual([]);
  });

  it("missing required attachment is a warning for the operator", async () => {
    const res = await op.post("/api/operator/leaves/preview", { employeeId: emp.id, leaveTypeId: types.sick.id, ...WEEK });
    const body = await json<{ balance: null; conflicts: Conflicts }>(res);
    expect(body.balance).toBeNull();
    expect(body.conflicts.warnings.map((w) => w.code)).toEqual(["conflicts.attachmentMissing"]);
  });
});

describe("soft delete and restore (Undo)", () => {
  it("delete + restore of an approved leave nets to the original balance", async () => {
    const leave = await createOk({ status: "approved" });
    expect((await paidBalance()).balance).toBe(15);

    expect((await op.del(`/api/operator/leaves/${leave.id}`)).status).toBe(200);
    expect((await paidBalance()).balance).toBe(20);
    expect((await op.get(`/api/operator/leaves/${leave.id}`)).status).toBe(404);
    const [row] = await db.select().from(leaveRequest).where(eq(leaveRequest.id, leave.id));
    expect(row!.deletedAt).not.toBeNull(); // soft delete: the row stays

    const restored = await op.post(`/api/operator/leaves/${leave.id}/restore`);
    expect(restored.status).toBe(200);
    expect((await paidBalance()).balance).toBe(15);
    expect((await ledgerOf(leave.id)).map((e) => e.entryType)).toEqual(["leave", "reversal", "leave"]);

    expect((await op.post(`/api/operator/leaves/${leave.id}/restore`)).status).toBe(409);
  });

  it("restore re-runs the blocking checks", async () => {
    const leave = await createOk({ status: "approved" });
    await op.del(`/api/operator/leaves/${leave.id}`);
    await createOk({ status: "approved" }); // the same dates are now taken
    const res = await op.post(`/api/operator/leaves/${leave.id}/restore`);
    expect(res.status).toBe(422);
  });
});

describe("list and detail", () => {
  it("lists non-deleted leaves overlapping the range with filters", async () => {
    const a = await createOk({ status: "approved" });
    await createOk({ status: "pending", startDate: "2025-06-02", endDate: "2025-06-03" });
    const deleted = await createOk({ status: "pending", startDate: "2025-03-10", endDate: "2025-03-10" });
    await op.del(`/api/operator/leaves/${deleted.id}`);

    const res = await op.get("/api/operator/leaves?from=2025-03-01&to=2025-03-31");
    const rows = await json<Array<Record<string, unknown>>>(res);
    expect(rows.map((r) => r.id)).toEqual([a.id]);
    expect(rows[0]).toMatchObject({
      employeeName: "Ines Test",
      leaveTypeName: "Paid leave",
      color: "blue",
      workingDays: 5,
      status: "approved",
      source: "operator",
      attachmentCount: 0,
    });
    const pending = await json<unknown[]>(await op.get("/api/operator/leaves?status=pending"));
    expect(pending).toHaveLength(1);
    expect((await op.get("/api/operator/leaves?from=nope")).status).toBe(400);
  });

  it("detail includes attachments and the stored conflict result", async () => {
    const leave = await createOk({ leaveTypeId: types.sick.id });
    const detail = await json<{ attachments: unknown[]; conflictResult: Conflicts }>(
      await op.get(`/api/operator/leaves/${leave.id}`),
    );
    expect(detail.attachments).toEqual([]);
    expect(detail.conflictResult.warnings.map((w) => w.code)).toEqual(["conflicts.attachmentMissing"]);
  });
});

describe("audit", () => {
  it("every leave mutation writes an audit_log row", async () => {
    const leave = await createOk({ status: "pending" });
    await op.post(`/api/operator/leaves/${leave.id}/status`, { status: "approved" });
    await op.patch(`/api/operator/leaves/${leave.id}`, { leaveTypeId: types.paid.id, ...WEEK, note: "x" });
    await op.del(`/api/operator/leaves/${leave.id}`);
    await op.post(`/api/operator/leaves/${leave.id}/restore`);
    const rows = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.entity, "leave_request"), eq(auditLog.entityId, leave.id)))
      .orderBy(asc(auditLog.createdAt));
    expect(rows.map((r) => r.action)).toEqual([
      "leave.create",
      "leave.status.approved",
      "leave.update",
      "leave.delete",
      "leave.restore",
    ]);
  });

  it("refuses leaves for archived employees", async () => {
    await db.update(employee).set({ status: "archived" }).where(eq(employee.id, emp.id));
    const res = await createLeave({});
    expect(res.status).toBe(409);
  });
});
