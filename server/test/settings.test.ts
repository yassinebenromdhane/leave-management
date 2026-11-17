// Step 4: Settings tabs (spec 1.5) and policies "from today / from leave-year start".
import { leaveYearStartFor } from "@leave/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "../src/auth/rateLimit";
import { db, sql as pg } from "../src/db/client";
import { auditLog, companySettings, department, leavePolicy } from "../src/db/schema";
import { todayIso } from "../src/domain/today";
import type { TestClient } from "./client";
import { createEmployee, resetDb } from "./db";
import { createLeaveTypes, json, signedInOperator } from "./operator";

let op: TestClient;
let types: Awaited<ReturnType<typeof createLeaveTypes>>;

const audits = (entity: string) => db.select().from(auditLog).where(eq(auditLog.entity, entity));

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  op = await signedInOperator();
  types = await createLeaveTypes();
});

afterAll(async () => {
  await pg.end();
});

describe("GET /settings", () => {
  it("returns company, departments with counts, every leave type (incl. inactive), policies and holidays of the year", async () => {
    const emp = await createEmployee();
    await op.patch(`/api/operator/leave-types/${types.unpaid.id}`, { isActive: false });
    await op.post("/api/operator/holidays", { date: "2031-05-01", name: "Labour Day" });
    const res = await op.get("/api/operator/settings?year=2031");
    expect(res.status).toBe(200);
    const body = await json<{
      company: { name: string; workDays: number; negativeLimitDays: number; locale: string };
      departments: { id: string; employeeCount: number }[];
      leaveTypes: { id: string; isActive: boolean }[];
      holidays: { date: string }[];
      holidayYear: number;
    }>(res);
    expect(body.company).toMatchObject({ name: "Test Co", workDays: 31, negativeLimitDays: 0 });
    expect(body.departments.find((d) => d.id === emp.departmentId)?.employeeCount).toBe(1);
    expect(body.leaveTypes).toHaveLength(4);
    expect(body.leaveTypes.find((t) => t.id === types.unpaid.id)?.isActive).toBe(false);
    expect(body.holidayYear).toBe(2031);
    expect(body.holidays.map((h) => h.date)).toEqual(["2031-05-01"]);
  });
});

describe("company", () => {
  it("patches a subset, validates the week mask / month / half-step, and audits", async () => {
    const ok = await op.patch("/api/operator/settings/company", { workDays: 63, leaveYearStartMonth: 6, negativeLimitDays: 2.5 });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ workDays: 63, leaveYearStartMonth: 6, negativeLimitDays: 2.5, name: "Test Co" });
    const [row] = await db.select().from(companySettings);
    expect(row!.negativeLimitDays).toBe("2.5");
    expect(await audits("company_settings")).toHaveLength(1);

    for (const bad of [{ workDays: 0 }, { workDays: 128 }, { leaveYearStartMonth: 13 }, { negativeLimitDays: 0.3 }, { negativeLimitDays: -1 }, {}]) {
      const res = await op.patch("/api/operator/settings/company", bad);
      expect(res.status).toBe(400);
    }
  });
});

describe("departments", () => {
  it("renames / reorders, and deletes only an empty department", async () => {
    const emp = await createEmployee();
    const res = await op.patch(`/api/operator/departments/${emp.departmentId}`, { name: "Ops", minStaffing: 2, sortOrder: 5 });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ name: "Ops", minStaffing: 2, sortOrder: 5, employeeCount: 1 });

    const busy = await op.del(`/api/operator/departments/${emp.departmentId}`);
    expect(busy.status).toBe(409);
    expect(await json(busy)).toMatchObject({ code: "departments.errors.notEmpty" });

    const [empty] = await db.insert(department).values({ name: "Empty" }).returning();
    expect((await op.del(`/api/operator/departments/${empty!.id}`)).status).toBe(200);
    expect(await db.select().from(department).where(eq(department.id, empty!.id))).toHaveLength(0);
    expect((await audits("department")).map((a) => a.action).sort()).toEqual(["department.delete", "department.update"]);
  });

  it("rejects a duplicate name with 409", async () => {
    const emp = await createEmployee();
    await db.insert(department).values({ name: "Taken" });
    const res = await op.patch(`/api/operator/departments/${emp.departmentId}`, { name: "Taken" });
    expect(res.status).toBe(409);
  });
});

describe("leave types", () => {
  it("creates with defaults, updates, deactivates (never deletes), and audits", async () => {
    const res = await op.post("/api/operator/leave-types", { name: "Training", color: "lime" });
    expect(res.status).toBe(201);
    const created = await json<{ id: string; sortOrder: number; isPaid: boolean; deductsBalance: boolean; annualCapDays: number | null }>(res);
    expect(created).toMatchObject({ isPaid: true, deductsBalance: true, annualCapDays: null, sortOrder: 4 });

    const upd = await op.patch(`/api/operator/leave-types/${created.id}`, {
      dayCountMode: "calendar",
      annualCapDays: 5,
      isActive: false,
      defaultSaveStatus: "pending",
    });
    expect(upd.status).toBe(200);
    expect(await json(upd)).toMatchObject({ dayCountMode: "calendar", annualCapDays: 5, isActive: false, defaultSaveStatus: "pending" });
    expect((await op.patch(`/api/operator/leave-types/${created.id}`, { color: "not-a-colour" })).status).toBe(400);
    expect((await audits("leave_type")).map((a) => a.action).sort()).toEqual(["leave_type.create", "leave_type.update"]);
  });
});

describe("policies", () => {
  it("applyFrom today vs leave-year start inserts new rows and keeps history; same date replaces", async () => {
    await db.update(companySettings).set({ leaveYearStartMonth: 4 });
    await db.insert(leavePolicy).values({ leaveTypeId: types.paid.id, accrualMode: "monthly", rateDays: "1.5", effectiveFrom: "2020-01-01" });
    const today = todayIso();
    const yearStart = leaveYearStartFor(today, 4);

    const a = await op.post(`/api/operator/leave-types/${types.paid.id}/policy`, { accrualMode: "monthly", rateDays: 2, applyFrom: "today" });
    expect(a.status).toBe(201);
    const aBody = await json<{ policy: { effectiveFrom: string }; current: { rateDays: number }; history: unknown[] }>(a);
    expect(aBody.policy.effectiveFrom).toBe(today);
    expect(aBody.current.rateDays).toBe(2);

    const b = await op.post(`/api/operator/leave-types/${types.paid.id}/policy`, {
      accrualMode: "annual",
      rateDays: 25,
      applyFrom: "leaveYearStart",
      carryoverCapDays: 5,
      carryoverExpiryMonthDay: "05-31",
    });
    expect(b.status).toBe(201);
    expect((await json<{ policy: { effectiveFrom: string } }>(b)).policy.effectiveFrom).toBe(yearStart);

    // same effective date again → replaced, not duplicated
    await op.post(`/api/operator/leave-types/${types.paid.id}/policy`, { accrualMode: "monthly", rateDays: 2.5, applyFrom: "today" });
    const rows = await db.select().from(leavePolicy).where(eq(leavePolicy.leaveTypeId, types.paid.id));
    const expectedCount = yearStart === today ? 2 : 3;
    expect(rows).toHaveLength(expectedCount);
    expect(rows.find((r) => r.effectiveFrom === "2020-01-01")!.rateDays).toBe("1.5");
    expect(rows.find((r) => r.effectiveFrom === today)!.rateDays).toBe("2.5");

    const policyAudits = await db.select().from(auditLog).where(and(eq(auditLog.entity, "leave_policy")));
    expect(policyAudits).toHaveLength(3);
    expect(policyAudits.some((x) => x.action === "leave_policy.replace")).toBe(true);
  });

  it("validates the rate step and the MM-DD format", async () => {
    expect((await op.post(`/api/operator/leave-types/${types.paid.id}/policy`, { accrualMode: "monthly", rateDays: 1.2, applyFrom: "today" })).status).toBe(400);
    expect(
      (await op.post(`/api/operator/leave-types/${types.paid.id}/policy`, { accrualMode: "monthly", rateDays: 1, applyFrom: "today", carryoverExpiryMonthDay: "13-01" })).status,
    ).toBe(400);
  });
});
