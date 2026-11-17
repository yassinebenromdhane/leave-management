// Step 4: manual "Run accrual" (spec 3.1, 4.2 rule 6).
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "../src/auth/rateLimit";
import { db, sql as pg } from "../src/db/client";
import { auditLog, leavePolicy, ledgerEntry } from "../src/db/schema";
import type { TestClient } from "./client";
import { createEmployee, resetDb } from "./db";
import { createLeaveTypes, json, signedInOperator } from "./operator";

let op: TestClient;
let types: Awaited<ReturnType<typeof createLeaveTypes>>;

type Preview = {
  rows: { employeeId: string; leaveTypeId: string; days: number; alreadyDone: boolean; periodKey: string }[];
  totals: { rows: number; toCreate: number; alreadyDone: number; days: number };
};

let n = 0;
const emp = (over: Parameters<typeof createEmployee>[0] = {}) =>
  createEmployee({ email: `e${++n}@test.local`, employeeCode: `E${n}`, ...over });

const accrualRows = (employeeId: string) =>
  db.select().from(ledgerEntry).where(and(eq(ledgerEntry.employeeId, employeeId), eq(ledgerEntry.entryType, "accrual")));

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  op = await signedInOperator();
  types = await createLeaveTypes();
  await db.insert(leavePolicy).values({ leaveTypeId: types.paid.id, accrualMode: "monthly", rateDays: "2.0", effectiveFrom: "2025-01-01" });
});

afterAll(async () => {
  await pg.end();
});

describe("monthly accrual", () => {
  it("runs twice for the same month but writes once, with one audit row per run", async () => {
    const e = await emp({ hireDate: "2024-01-01" });
    const first = await op.post("/api/operator/accrual/run", { period: "2025-03" });
    expect(first.status).toBe(200);
    expect(await json(first)).toMatchObject({ created: 1, skipped: 0, days: 2 });
    const second = await json(await op.post("/api/operator/accrual/run", { period: "2025-03" }));
    expect(second).toMatchObject({ created: 0, skipped: 1 });

    const rows = await accrualRows(e.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ periodKey: "2025-03", effectiveDate: "2025-03-01", days: "2.0", leaveTypeId: types.paid.id });
    const audits = await db.select().from(auditLog).where(eq(auditLog.entity, "accrual"));
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ entityId: "2025-03", action: "accrual.run" });

    const preview = await json<Preview>(await op.post("/api/operator/accrual/preview", { period: "2025-03" }));
    expect(preview.rows[0]).toMatchObject({ employeeId: e.id, days: 2, alreadyDone: true });
    expect(preview.totals).toMatchObject({ rows: 1, toCreate: 0, alreadyDone: 1 });
  });

  it("prorates hires and leavers, includes archived leavers of that month, skips zero-day rows", async () => {
    const hire = await emp({ hireDate: "2025-03-16" }); // 16/31 × 2 = 1.03 → 1
    const leaver = await emp({ hireDate: "2020-01-01", endDate: "2025-03-15", status: "archived" }); // 15/31 × 2 → 1
    const gone = await emp({ hireDate: "2020-01-01", endDate: "2025-02-28", status: "archived" });
    const late = await emp({ hireDate: "2025-03-31" }); // 1/31 × 2 = 0.06 → 0 → skipped
    const future = await emp({ hireDate: "2025-04-01" });

    const preview = await json<Preview>(await op.post("/api/operator/accrual/preview", { period: "2025-03" }));
    const byEmp = new Map(preview.rows.map((r) => [r.employeeId, r.days]));
    expect(byEmp.get(hire.id)).toBe(1);
    expect(byEmp.get(leaver.id)).toBe(1);
    expect(byEmp.has(gone.id)).toBe(false);
    expect(byEmp.has(late.id)).toBe(false);
    expect(byEmp.has(future.id)).toBe(false);
    expect(preview.totals).toMatchObject({ toCreate: 2, days: 2 });

    expect(await json(await op.post("/api/operator/accrual/run", { period: "2025-03" }))).toMatchObject({ created: 2 });
    expect(await accrualRows(late.id)).toHaveLength(0);
  });

  it("uses the policy effective at the period start (history is respected)", async () => {
    await db.insert(leavePolicy).values({ leaveTypeId: types.paid.id, accrualMode: "monthly", rateDays: "3.0", effectiveFrom: "2025-03-02" });
    const e = await emp();
    const p = await json<Preview>(await op.post("/api/operator/accrual/preview", { period: "2025-03" }));
    expect(p.rows.find((r) => r.employeeId === e.id)?.days).toBe(2);
    const april = await json<Preview>(await op.post("/api/operator/accrual/preview", { period: "2025-04" }));
    expect(april.rows.find((r) => r.employeeId === e.id)?.days).toBe(3);
  });

  it("annual allowance override: monthly rate = override / 12, rounded", async () => {
    const e = await emp({ annualAllowanceOverride: "30.0" });
    const p = await json<Preview>(await op.post("/api/operator/accrual/preview", { period: "2025-03" }));
    expect(p.rows.find((r) => r.employeeId === e.id)?.days).toBe(2.5);
  });

  it("refuses a future month with 422 and a malformed period with 400", async () => {
    const res = await op.post("/api/operator/accrual/run", { period: "2099-01" });
    expect(res.status).toBe(422);
    expect(await json(res)).toMatchObject({ code: "accrual.errors.futurePeriod" });
    expect((await op.post("/api/operator/accrual/run", { period: "2025-13" })).status).toBe(400);
    expect(await db.select().from(auditLog).where(eq(auditLog.entity, "accrual"))).toHaveLength(0);
  });
});

describe("annual accrual", () => {
  beforeEach(async () => {
    await db.insert(leavePolicy).values({ leaveTypeId: types.comp.id, accrualMode: "annual", rateDays: "24.0", effectiveFrom: "2025-01-01" });
  });

  it("grants only on the leave-year start month, keyed by the leave-year label", async () => {
    const e = await emp();
    const march = await json<Preview>(await op.post("/api/operator/accrual/preview", { period: "2025-03" }));
    expect(march.rows.some((r) => r.leaveTypeId === types.comp.id)).toBe(false);

    await op.post("/api/operator/accrual/run", { period: "2025-01" });
    const [grant] = await db
      .select()
      .from(ledgerEntry)
      .where(and(eq(ledgerEntry.employeeId, e.id), eq(ledgerEntry.leaveTypeId, types.comp.id)));
    expect(grant).toMatchObject({ entryType: "accrual", periodKey: "Y2025", effectiveDate: "2025-01-01", days: "24.0" });
  });

  it("the override IS the annual grant", async () => {
    const e = await emp({ annualAllowanceOverride: "30.0" });
    const p = await json<Preview>(await op.post("/api/operator/accrual/preview", { period: "2025-01" }));
    expect(p.rows.find((r) => r.employeeId === e.id && r.leaveTypeId === types.comp.id)).toMatchObject({ days: 30, periodKey: "Y2025" });
  });
});
