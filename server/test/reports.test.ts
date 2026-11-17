// Step 4: payroll summary + leave detail (spec 1.6), XLSX and CSV exports.
import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "../src/auth/rateLimit";
import { db, sql as pg } from "../src/db/client";
import { companySettings, employee, ledgerEntry } from "../src/db/schema";
import type { TestClient } from "./client";
import { createEmployee, resetDb } from "./db";
import { createLeaveTypes, json, signedInOperator } from "./operator";

let op: TestClient;
let types: Awaited<ReturnType<typeof createLeaveTypes>>;
let ines: Awaited<ReturnType<typeof createEmployee>>;
let leaver: Awaited<ReturnType<typeof createEmployee>>;
let gone: Awaited<ReturnType<typeof createEmployee>>;

type Table = { columns: { key: string; label: string; kind: string }[]; rows: Record<string, unknown>[] };

const BOM = String.fromCharCode(0xfeff);
const JAN = "from=2026-01-01&to=2026-01-31";
const FEB = "from=2026-02-01&to=2026-02-28";

async function approved(employeeId: string, leaveTypeId: string, startDate: string, endDate: string) {
  const res = await op.post("/api/operator/leaves", { employeeId, leaveTypeId, startDate, endDate, status: "approved" });
  expect(res.status).toBe(201);
}

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  op = await signedInOperator();
  types = await createLeaveTypes();
  ines = await createEmployee({ hireDate: "2024-01-01", fullName: "Ines", email: "a@test.local", employeeCode: "A1" });
  leaver = await createEmployee({ hireDate: "2020-01-01", endDate: "2026-02-15", fullName: "Leaver", email: "b@test.local", employeeCode: "B1" });
  gone = await createEmployee({ hireDate: "2020-01-01", endDate: "2025-06-30", fullName: "Gone", email: "c@test.local", employeeCode: "C1", status: "archived" });
  await db.insert(ledgerEntry).values({
    employeeId: ines.id,
    leaveTypeId: types.paid.id,
    entryType: "opening",
    days: "20.0",
    effectiveDate: "2024-01-01",
    periodKey: "opening",
  });
  await approved(ines.id, types.paid.id, "2026-01-28", "2026-02-03"); // Wed–Tue: Jan 3 + Feb 2
  await approved(leaver.id, types.unpaid.id, "2026-02-02", "2026-02-04");
  await db.update(employee).set({ status: "archived" }).where(eq(employee.id, leaver.id));
});

afterAll(async () => {
  await pg.end();
});

const rowOf = (t: Table, id: string) => t.rows.find((r) => r.employeeId === id);

describe("payroll summary", () => {
  it("splits a Jan 28 – Feb 3 leave into Jan 3 / Feb 2 with opening and closing balances", async () => {
    const jan = await json<Table>(await op.get(`/api/operator/reports/payroll?${JAN}`));
    expect(rowOf(jan, ines.id)).toMatchObject({
      employeeCode: "A1",
      [`type:${types.paid.id}`]: 3,
      [`balanceStart:${types.paid.id}`]: 20,
      [`balanceEnd:${types.paid.id}`]: 15,
      unpaidDays: 0,
    });
    const feb = await json<Table>(await op.get(`/api/operator/reports/payroll?${FEB}`));
    expect(rowOf(feb, ines.id)).toMatchObject({
      [`type:${types.paid.id}`]: 2,
      [`balanceStart:${types.paid.id}`]: 15,
      [`balanceEnd:${types.paid.id}`]: 15,
    });
    expect(feb.columns.map((c) => c.key)).toContain(`balanceEnd:${types.comp.id}`);
    expect(feb.columns.map((c) => c.key)).not.toContain(`balanceEnd:${types.sick.id}`);
  });

  it("keeps an archived employee with leave in the period and drops one who left before it", async () => {
    const feb = await json<Table>(await op.get(`/api/operator/reports/payroll?${FEB}`));
    expect(rowOf(feb, leaver.id)).toMatchObject({ [`type:${types.unpaid.id}`]: 3, unpaidDays: 3 });
    expect(rowOf(feb, gone.id)).toBeUndefined();
  });

  it("validates the period: from > to is 400, more than 366 days is 422", async () => {
    expect((await op.get("/api/operator/reports/payroll?from=2026-02-01&to=2026-01-01")).status).toBe(400);
    const long = await op.get("/api/operator/reports/payroll?from=2025-01-01&to=2026-01-02");
    expect(long.status).toBe(422);
    expect(await json(long)).toMatchObject({ code: "reports.errors.periodTooLong" });
    expect((await op.get("/api/operator/reports/payroll?from=2028-01-01&to=2028-12-31")).status).toBe(200);
  });
});

describe("leave detail", () => {
  it("lists every non-deleted leave overlapping the period with its in-period share", async () => {
    const jan = await json<Table>(await op.get(`/api/operator/reports/leave-detail?${JAN}`));
    expect(jan.rows).toHaveLength(1);
    expect(jan.rows[0]).toMatchObject({
      fullName: "Ines",
      startDate: "2026-01-28",
      endDate: "2026-02-03",
      days: 5,
      daysInPeriod: 3,
      status: "approved",
      attachment: false,
      source: "operator",
    });
  });
});

describe("exports", () => {
  const bytes = async (res: Response) => new Uint8Array(await res.arrayBuffer());

  it("CSV (en): BOM, comma separator, dot decimal, ISO dates, no-store download", async () => {
    const res = await op.get(`/api/operator/reports/leave-detail/export?${JAN}&format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="leave-detail-2026-01-01_2026-01-31.csv"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    const b = await bytes(res);
    expect([...b.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(b);
    expect(text.startsWith(`${BOM}Employee code,Employee,Department`)).toBe(true);
    expect(text).toContain("A1,Ines,");
    expect(text).toContain(",2026-01-28,2026-02-03,Full day,Full day,5.0,3.0,Approved,");
  });

  it("CSV (fr): semicolon separator and comma decimal", async () => {
    await db.update(companySettings).set({ locale: "fr-FR" });
    const res = await op.get(`/api/operator/reports/payroll/export?${JAN}&format=csv`);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="payroll-2026-01.csv"');
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await bytes(res));
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.split("\r\n")[0]!.startsWith(`${BOM}Matricule;Salarié;Service;`)).toBe(true);
    expect(text).toMatch(/A1;Ines;[^;]+;3,0;/);
    expect(text).toContain("20,0;15,0");
  });

  it("XLSX parses back with a frozen bold header, numeric day cells and real dates", async () => {
    const res = await op.get(`/api/operator/reports/leave-detail/export?${JAN}&format=xlsx`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await res.arrayBuffer()) as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.name).toBe("Leave detail");
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ws.getRow(1).getCell(1).value).toBe("Employee code");
    expect(ws.getRow(1).font?.bold ?? ws.getRow(1).getCell(1).font?.bold).toBe(true);
    const row = ws.getRow(2);
    const daysCell = row.getCell(9);
    expect(daysCell.value).toBe(5);
    expect(daysCell.numFmt).toBe("0.0");
    expect(row.getCell(10).value).toBe(3);
    const start = row.getCell(5).value;
    expect(start).toBeInstanceOf(Date);
    expect((start as Date).toISOString().slice(0, 10)).toBe("2026-01-28");
  });

  it("XLSX payroll uses the localized sheet name and file name", async () => {
    await db.update(companySettings).set({ locale: "fr-FR" });
    const res = await op.get(`/api/operator/reports/payroll/export?from=2026-01-01&to=2026-03-31&format=xlsx`);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="payroll-2026-01-01_2026-03-31.xlsx"');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await res.arrayBuffer()) as ArrayBuffer);
    expect(wb.worksheets[0]!.name).toBe("Synthèse paie");
  });
});
