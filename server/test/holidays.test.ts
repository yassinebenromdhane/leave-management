// Step 4: public holidays (spec 1.5) and rule 8 (holiday change → recalculation on confirm).
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "../src/auth/rateLimit";
import { db, sql as pg } from "../src/db/client";
import { auditLog, holiday, leaveRequest, ledgerEntry } from "../src/db/schema";
import type { TestClient } from "./client";
import { createEmployee, resetDb } from "./db";
import { createLeaveTypes, json, signedInOperator } from "./operator";

let op: TestClient;
let types: Awaited<ReturnType<typeof createLeaveTypes>>;
let emp: Awaited<ReturnType<typeof createEmployee>>;

type Affected = { id: string; status: string; oldDays: number; newDays: number; employeeName: string };
type HolidayResponse = { holiday: { id: string; date: string }; affectedLeaves: Affected[] };

async function leave(startDate: string, endDate: string, status: "approved" | "pending") {
  const res = await op.post("/api/operator/leaves", { employeeId: emp.id, leaveTypeId: types.paid.id, startDate, endDate, status });
  expect(res.status).toBe(201);
  return json<{ id: string; workingDays: number }>(res);
}

const ledgerOf = (id: string) =>
  db.select().from(ledgerEntry).where(eq(ledgerEntry.leaveRequestId, id)).orderBy(asc(ledgerEntry.createdAt));
const requestOf = async (id: string) => (await db.select().from(leaveRequest).where(eq(leaveRequest.id, id)))[0]!;

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  op = await signedInOperator();
  types = await createLeaveTypes();
  emp = await createEmployee({ hireDate: "2024-01-01" });
  await db.insert(ledgerEntry).values({
    employeeId: emp.id,
    leaveTypeId: types.paid.id,
    entryType: "opening",
    days: "40.0",
    effectiveDate: "2024-01-01",
    periodKey: "opening",
  });
});

afterAll(async () => {
  await pg.end();
});

describe("holiday CRUD", () => {
  it("creates, lists by year, renames, moves, deletes, rejects duplicates and audits every change", async () => {
    const created = await op.post("/api/operator/holidays", { date: "2099-07-14", name: "Fête", source: "closure", isConfirmed: false });
    expect(created.status).toBe(201);
    const { holiday: h } = await json<HolidayResponse>(created);

    const list = await json<{ date: string; source: string; isConfirmed: boolean }[]>(await op.get("/api/operator/holidays?year=2099"));
    expect(list).toEqual([expect.objectContaining({ date: "2099-07-14", source: "closure", isConfirmed: false })]);

    expect((await op.post("/api/operator/holidays", { date: "2099-07-14", name: "Dup" })).status).toBe(409);

    const renamed = await json<HolidayResponse>(await op.patch(`/api/operator/holidays/${h.id}`, { name: "National Day", isConfirmed: true }));
    expect(renamed.affectedLeaves).toEqual([]);
    expect((await op.patch(`/api/operator/holidays/${h.id}`, { date: "2099-07-15" })).status).toBe(200);
    expect((await op.del(`/api/operator/holidays/${h.id}`)).status).toBe(200);
    expect(await db.select().from(holiday)).toHaveLength(0);

    const actions = (await db.select().from(auditLog).where(eq(auditLog.entity, "holiday"))).map((a) => a.action).sort();
    expect(actions).toEqual(["holiday.create", "holiday.delete", "holiday.update", "holiday.update"]);
  });
});

describe("rule 8", () => {
  it("a holiday inside an approved future leave is listed; recalculate writes reversal + new entry and sets hrChangedAt", async () => {
    const approved = await leave("2099-03-02", "2099-03-06", "approved"); // Mon–Fri = 5
    const past = await leave("2025-03-03", "2025-03-07", "approved"); // over: never recalculated

    const res = await json<HolidayResponse>(await op.post("/api/operator/holidays", { date: "2099-03-04", name: "New" }));
    expect(res.affectedLeaves).toEqual([
      expect.objectContaining({ id: approved.id, status: "approved", oldDays: 5, newDays: 4, employeeName: emp.fullName }),
    ]);
    // the change itself is already saved; nothing recalculated yet
    expect((await requestOf(approved.id)).workingDays).toBe("5.0");
    await db.insert(holiday).values({ date: "2025-03-05", name: "Past" });
    expect(await json(await op.post("/api/operator/holidays/recalculate", { leaveIds: [past.id] }))).toMatchObject({ updated: 0, unchanged: 1 });

    const recalc = await op.post("/api/operator/holidays/recalculate", { leaveIds: [approved.id] });
    expect(recalc.status).toBe(200);
    expect(await json(recalc)).toMatchObject({ updated: 1, skipped: [] });

    const row = await requestOf(approved.id);
    expect(row.workingDays).toBe("4.0");
    expect(row.hrChangedAt).not.toBeNull();
    expect((await ledgerOf(approved.id)).map((e) => [e.entryType, e.days])).toEqual([
      ["leave", "-5.0"],
      ["reversal", "5.0"],
      ["leave", "-4.0"],
    ]);
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, "leave.recalculate"));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.entityId).toBe(approved.id);

    // a second confirm is a no-op (re-verified inside the transaction)
    expect(await json(await op.post("/api/operator/holidays/recalculate", { leaveIds: [approved.id] }))).toMatchObject({ updated: 0, unchanged: 1 });
    expect(await ledgerOf(approved.id)).toHaveLength(3);
  });

  it("pending leaves only update their snapshot; deleting / half-day toggles are listed too", async () => {
    const pending = await leave("2099-03-09", "2099-03-13", "pending");
    const created = await json<HolidayResponse>(await op.post("/api/operator/holidays", { date: "2099-03-11", name: "H" }));
    expect(created.affectedLeaves.map((a) => [a.id, a.oldDays, a.newDays])).toEqual([[pending.id, 5, 4]]);

    await op.post("/api/operator/holidays/recalculate", { leaveIds: [pending.id] });
    expect((await requestOf(pending.id)).workingDays).toBe("4.0");
    expect(await ledgerOf(pending.id)).toHaveLength(0);

    const half = await json<HolidayResponse>(await op.patch(`/api/operator/holidays/${created.holiday.id}`, { isHalfDay: true }));
    expect(half.affectedLeaves.map((a) => [a.oldDays, a.newDays])).toEqual([[4, 4.5]]);

    const moved = await json<HolidayResponse>(await op.patch(`/api/operator/holidays/${created.holiday.id}`, { date: "2099-03-20" }));
    expect(moved.affectedLeaves.map((a) => [a.oldDays, a.newDays])).toEqual([[4, 5]]);

    await op.patch(`/api/operator/holidays/${created.holiday.id}`, { date: "2099-03-12", isHalfDay: false });
    const deleted = await json<{ affectedLeaves: Affected[] }>(await op.del(`/api/operator/holidays/${created.holiday.id}`));
    expect(deleted.affectedLeaves.map((a) => [a.oldDays, a.newDays])).toEqual([[4, 5]]);
  });

  it("a leave that would drop to 0 days is skipped, not cancelled", async () => {
    const single = await leave("2099-03-20", "2099-03-20", "approved");
    const res = await json<HolidayResponse>(await op.post("/api/operator/holidays", { date: "2099-03-20", name: "H" }));
    expect(res.affectedLeaves[0]).toMatchObject({ id: single.id, oldDays: 1, newDays: 0 });
    const recalc = await json(await op.post("/api/operator/holidays/recalculate", { leaveIds: [single.id] }));
    expect(recalc).toMatchObject({ updated: 0, skipped: [{ id: single.id, code: "conflicts.zeroDays" }] });
    const row = await requestOf(single.id);
    expect(row).toMatchObject({ status: "approved", workingDays: "1.0" });
  });
});
