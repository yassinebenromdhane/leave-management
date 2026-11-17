// Step 5 verification: employee portal API (spec 1.7, 4.3). Isolation (session-scoped queries,
// someone else's ids → 404), the "Away" projection, the portal submit matrix, withdraw and its
// race against an operator decision, decision notifications and emails.
import { PORTAL_UNDO_WINDOW_MS, portalLeaveRowSchema, portalTeamResponseSchema } from "@leave/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "../src/auth/rateLimit";
import { db, sql as pg } from "../src/db/client";
import { attachment, auditLog, companySettings, leaveRequest, leaveType, ledgerEntry, notification } from "../src/db/schema";
import { settleBackgroundJobs } from "../src/services/backgroundJobs";
import { testOutbox } from "../src/services/email";
import type { TestClient } from "./client";
import { createEmployee, resetDb } from "./db";
import { createLeaveTypes, json, signedInEmployee, signedInOperator } from "./operator";

type Types = Awaited<ReturnType<typeof createLeaveTypes>>;
type Emp = Awaited<ReturnType<typeof createEmployee>>;
type Row = { id: string; status: string; workingDays: number; source: string; addedByHr: boolean; changedByHr: boolean };
type ErrorBody = { code: string; conflicts?: { blocking: { code: string }[]; warnings: { code: string; params?: Record<string, unknown> }[] } };

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
// Mon 1 – Fri 5 March 2027: 5 working days, in the future (pending / upcoming lists).
const WEEK = { startDate: "2027-03-01", endDate: "2027-03-05" };

let op: TestClient;
let types: Types;
let empA: Emp;
let empB: Emp;
let empC: Emp; // other department
let a: TestClient;
let b: TestClient;

async function giveOpening(employeeId: string, leaveTypeId: string, days: string) {
  await db.insert(ledgerEntry).values({ employeeId, leaveTypeId, entryType: "opening", days, effectiveDate: "2024-01-01", periodKey: "opening" });
}

function submit(c: TestClient, data: Record<string, unknown>, file?: File) {
  const f = new FormData();
  f.append("data", JSON.stringify({ leaveTypeId: types.paid.id, ...WEEK, ...data }));
  if (file) f.append("file", file);
  return c.upload("/api/me/leaves", f);
}

async function submitOk(c: TestClient, data: Record<string, unknown> = {}, file?: File): Promise<Row> {
  const res = await submit(c, data, file);
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return json<Row>(res);
}

/** Operator-logged approved leave (the realistic way approved teammate leave exists). */
async function opApproved(employeeId: string, span: { startDate: string; endDate: string }, extra: Record<string, unknown> = {}) {
  const res = await op.post("/api/operator/leaves", { employeeId, leaveTypeId: types.unpaid.id, ...span, status: "approved", ...extra });
  expect(res.status).toBe(201);
  return json<{ id: string }>(res);
}

const setSettings = (v: Partial<typeof companySettings.$inferInsert>) =>
  db.update(companySettings).set(v).where(eq(companySettings.id, 1));

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  testOutbox.length = 0;
  op = await signedInOperator();
  types = await createLeaveTypes();
  empA = await createEmployee({ fullName: "Alice A", employeeCode: "A-1", email: "alice@test.local" });
  empB = await createEmployee({ fullName: "Bruno B", employeeCode: "B-1", email: "bruno@test.local", departmentId: empA.departmentId });
  empC = await createEmployee({ fullName: "Chloe C", employeeCode: "C-1", email: "chloe@test.local" });
  await giveOpening(empA.id, types.paid.id, "20.0");
  await giveOpening(empB.id, types.paid.id, "20.0");
  a = await signedInEmployee(op, empA.id);
  b = await signedInEmployee(op, empB.id);
});

afterAll(async () => {
  await settleBackgroundJobs();
  await pg.end();
});

describe("isolation: someone else's ids are 404", () => {
  it("A cannot withdraw, list attachments of, or download the attachment of B's leave", async () => {
    const bLeave = await submitOk(b, {}, new File([PDF], "b.pdf", { type: "application/pdf" }));
    const [bFile] = await db.select().from(attachment).where(eq(attachment.leaveRequestId, bLeave.id));

    expect((await a.post(`/api/me/leaves/${bLeave.id}/withdraw`)).status).toBe(404);
    expect(await json(await a.get(`/api/me/leaves/${bLeave.id}/attachments`))).toEqual([]);
    expect((await a.get(`/api/files/${bFile!.id}`)).status).toBe(404);
    expect((await a.del(`/api/me/attachments/${bFile!.id}`)).status).toBe(404);
    // B's request is untouched; the owner can still download.
    const [still] = await db.select().from(leaveRequest).where(eq(leaveRequest.id, bLeave.id));
    expect(still!.status).toBe("pending");
    expect((await b.get(`/api/files/${bFile!.id}`)).status).toBe(200);
    // A's own list does not contain it.
    const mine = await json<Row[]>(await a.get("/api/me/leaves"));
    expect(mine.map((l) => l.id)).not.toContain(bLeave.id);
  });

  it("A's ledger shows only A's entries, even for a type B also uses", async () => {
    await db.insert(ledgerEntry).values({
      employeeId: empB.id,
      leaveTypeId: types.paid.id,
      entryType: "adjustment",
      days: "3.0",
      effectiveDate: "2025-01-01",
      note: "B only",
    });
    const res = await json<{ entries: { days: number; note: string | null; runningBalance: number }[] }>(
      await a.get(`/api/me/ledger/${types.paid.id}`),
    );
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]).toMatchObject({ days: 20, runningBalance: 20 });
    expect(JSON.stringify(res)).not.toContain("B only");
  });

  it("rejects an employeeId smuggled into the submit payload (400) and never files for B", async () => {
    const res = await submit(a, { employeeId: empB.id });
    expect(res.status).toBe(400);
    expect(await db.select().from(leaveRequest)).toHaveLength(0);
  });

  it("the read endpoint only marks the caller's own notifications", async () => {
    const bLeave = await submitOk(b);
    expect((await op.post(`/api/operator/leaves/${bLeave.id}/status`, { status: "approved" })).status).toBe(200);
    const [bNote] = await db
      .select()
      .from(notification)
      .where(and(eq(notification.recipientEmployeeId, empB.id), eq(notification.channel, "in_app")));
    expect((await a.post(`/api/me/notifications/${bNote!.id}/read`)).status).toBe(404);
    const [unchanged] = await db.select().from(notification).where(eq(notification.id, bNote!.id));
    expect(unchanged!.readAt).toBeNull();
    expect((await b.post(`/api/me/notifications/${bNote!.id}/read`)).status).toBe(200);
    const [read] = await db.select().from(notification).where(eq(notification.id, bNote!.id));
    expect(read!.readAt).not.toBeNull();
  });

  it("the operator cannot use /api/me and signed-out callers get 401", async () => {
    expect((await op.get("/api/me/dashboard")).status).toBe(403);
    const { TestClient } = await import("./client");
    expect((await new TestClient().get("/api/me/leaves")).status).toBe(401);
  });
});

describe("GET /me/team: the Away projection", () => {
  const MARCH = "/api/me/team?from=2027-03-01&to=2027-03-31";

  beforeEach(async () => {
    await opApproved(empB.id, { startDate: "2027-03-08", endDate: "2027-03-09" }, { note: "secret note" });
    await opApproved(empC.id, { startDate: "2027-03-10", endDate: "2027-03-10" });
    await opApproved(empA.id, { startDate: "2027-03-15", endDate: "2027-03-15" });
    // B's pending request must stay invisible.
    await op.post("/api/operator/leaves", { employeeId: empB.id, leaveTypeId: types.unpaid.id, startDate: "2027-03-22", endDate: "2027-03-22", status: "pending" });
  });

  it("department scope: approved teammates only, self excluded, exactly six keys", async () => {
    const body = await json(await a.get(MARCH));
    const parsed = portalTeamResponseSchema.parse(body); // .strict(): throws on any extra key
    expect(parsed.scope).toBe("department");
    expect(parsed.people).toEqual([
      { employeeId: empB.id, fullName: "Bruno B", startDate: "2027-03-08", endDate: "2027-03-09", startHalf: "full", endHalf: "full" },
    ]);
    expect(Object.keys(parsed.people[0]!).sort()).toEqual(["employeeId", "endDate", "endHalf", "fullName", "startDate", "startHalf"]);
    expect(JSON.stringify(body)).not.toContain("secret note");
  });

  it("company scope includes other departments; off returns nothing", async () => {
    await setSettings({ teamVisibility: "company" });
    const company = portalTeamResponseSchema.parse(await json(await a.get(MARCH)));
    expect(company.people.map((p) => p.fullName)).toEqual(["Bruno B", "Chloe C"]);

    await setSettings({ teamVisibility: "off" });
    expect(await json(await a.get(MARCH))).toEqual({ scope: "off", people: [] });
  });

  it("rejects ranges over 31 days", async () => {
    const res = await a.get("/api/me/team?from=2027-03-01&to=2027-04-15");
    expect(res.status).toBe(400);
  });

  it("preview carries the Away strip and no colleague names in conflicts", async () => {
    const res = await a.post("/api/me/leaves/preview", { leaveTypeId: types.paid.id, startDate: "2027-03-08", endDate: "2027-03-09" });
    expect(res.status).toBe(200);
    const body = await json<{ days: number; balance: { available: number; after: number }; team: unknown; conflicts: ErrorBody["conflicts"] }>(res);
    expect(body.days).toBe(2);
    expect(body.balance).toEqual({ available: 20, after: 18 });
    expect(portalTeamResponseSchema.parse(body.team).people).toHaveLength(1);
    const colleagues = body.conflicts!.warnings.find((w) => w.code === "conflicts.colleaguesOff");
    expect(colleagues?.params).not.toHaveProperty("people");
  });
});

describe("POST /me/leaves: portal submit rules (spec 1.7)", () => {
  it("writes a pending portal request + operator notification + audit, with the server's day count", async () => {
    const row = await submitOk(a, { startHalf: "pm", note: "family trip" });
    expect(portalLeaveRowSchema.parse(row)).toMatchObject({ status: "pending", source: "portal", workingDays: 4.5, addedByHr: false, changedByHr: false });

    const [stored] = await db.select().from(leaveRequest).where(eq(leaveRequest.id, row.id));
    expect(stored).toMatchObject({ employeeId: empA.id, status: "pending", source: "portal", workingDays: "4.5", hasWarning: false });
    expect(stored!.submittedAt).not.toBeNull();
    const notes = await db.select().from(notification).where(eq(notification.leaveRequestId, row.id));
    expect(notes).toEqual([expect.objectContaining({ recipient: "operator", kind: "submitted", channel: "in_app" })]);
    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, row.id));
    expect(audits.map((x) => x.action)).toEqual(["leave.submit"]);
    // Nothing in the ledger for a pending request; it only reserves.
    expect(await db.select().from(ledgerEntry).where(eq(ledgerEntry.leaveRequestId, row.id))).toHaveLength(0);
  });

  it("blocks an overlap with the employee's own leave (422)", async () => {
    await submitOk(a);
    const res = await submit(a, { startDate: "2027-03-04", endDate: "2027-03-08" });
    expect(res.status).toBe(422);
    const body = await json<ErrorBody>(res);
    expect(body.code).toBe("leave.errors.blocked");
    expect(body.conflicts!.blocking.map((x) => x.code)).toContain("conflicts.selfOverlap");
  });

  it("blocks zero working days (weekend only) and dates outside employment (422)", async () => {
    const weekend = await json<ErrorBody>(await submit(a, { startDate: "2027-03-06", endDate: "2027-03-07" }));
    expect(weekend.conflicts!.blocking.map((x) => x.code)).toEqual(["conflicts.zeroDays"]);
    const before = await submit(a, { startDate: "2023-12-01", endDate: "2023-12-01" });
    expect(before.status).toBe(422);
    expect((await json<ErrorBody>(before)).conflicts!.blocking.map((x) => x.code)).toContain("conflicts.outsideEmployment");
  });

  it("blocks a negative balance when negatives are not allowed", async () => {
    await setSettings({ allowNegative: false });
    const res = await submit(a, { startDate: "2027-03-01", endDate: "2027-03-31" }); // 23 days > 20
    expect(res.status).toBe(422);
    expect((await json<ErrorBody>(res)).conflicts!.blocking.map((x) => x.code)).toEqual(["conflicts.negativeBalance"]);
  });

  it("an allowed negative balance needs acknowledgeNegative", async () => {
    await setSettings({ allowNegative: true, negativeLimitDays: "5.0" });
    const long = { startDate: "2027-03-01", endDate: "2027-03-30" }; // 22 working days → −2 (within the 5-day limit)
    const res = await submit(a, long);
    expect(res.status).toBe(422);
    expect((await json<ErrorBody>(res)).code).toBe("portal.errors.acknowledgeNegative");
    const ok = await submitOk(a, { ...long, acknowledgeNegative: true });
    const [stored] = await db.select().from(leaveRequest).where(eq(leaveRequest.id, ok.id));
    expect(stored!.hasWarning).toBe(true);
  });

  it("accepts sick leave without a certificate (flagged), blocks other required-attachment types", async () => {
    const sick = await submitOk(a, { leaveTypeId: types.sick.id });
    const [stored] = await db.select().from(leaveRequest).where(eq(leaveRequest.id, sick.id));
    expect(stored!.hasWarning).toBe(true);
    expect(JSON.stringify(stored!.conflictResult)).toContain("conflicts.attachmentMissing");

    await db.update(leaveType).set({ requiresAttachment: true }).where(eq(leaveType.id, types.comp.id));
    await giveOpening(empA.id, types.comp.id, "10.0");
    const comp = await submit(a, { leaveTypeId: types.comp.id, startDate: "2027-04-05", endDate: "2027-04-05" });
    expect(comp.status).toBe(422);
    expect((await json<ErrorBody>(comp)).conflicts!.blocking.map((x) => x.code)).toEqual(["conflicts.attachmentMissing"]);
    // With the file it goes through, and the attachment is stored.
    const withFile = await submitOk(
      a,
      { leaveTypeId: types.comp.id, startDate: "2027-04-05", endDate: "2027-04-05" },
      new File([PDF], "proof.pdf", { type: "application/pdf" }),
    );
    expect((withFile as Row & { attachmentCount: number }).attachmentCount).toBe(1);
  });

  it("rejects a disguised file (415) without creating the request", async () => {
    const res = await submit(a, {}, new File([PDF], "x.png", { type: "image/png" }));
    expect(res.status).toBe(415);
    expect(await db.select().from(leaveRequest)).toHaveLength(0);
  });

  it("colleagues off are informational only", async () => {
    await opApproved(empB.id, WEEK);
    const row = await submitOk(a);
    const [stored] = await db.select().from(leaveRequest).where(eq(leaveRequest.id, row.id));
    expect(stored!.hasWarning).toBe(true);
    expect(JSON.stringify(stored!.conflictResult)).toContain("conflicts.colleaguesOff");
  });
});

describe("withdraw", () => {
  it("withdraws only while pending; writes operator notification + audit", async () => {
    const row = await submitOk(a);
    const res = await a.post(`/api/me/leaves/${row.id}/withdraw`);
    expect(res.status).toBe(200);
    expect((await json<Row>(res)).status).toBe("cancelled");
    const notes = await db.select().from(notification).where(eq(notification.leaveRequestId, row.id));
    expect(notes.map((n) => n.kind).sort()).toEqual(["submitted", "withdrawn"]);
    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, row.id));
    expect(audits.map((x) => x.action)).toContain("leave.withdraw");

    const again = await a.post(`/api/me/leaves/${row.id}/withdraw`);
    expect(again.status).toBe(409);
    expect((await json<ErrorBody>(again)).code).toBe("portal.errors.alreadyDecided");

    // A stale operator approve after the withdraw is a clear 409, never a silent re-open.
    const late = await op.post(`/api/operator/leaves/${row.id}/status`, { status: "approved" });
    expect(late.status).toBe(409);
    expect((await json<ErrorBody>(late)).code).toBe("leave.errors.withdrawn");
  });

  it("cannot withdraw an approved leave", async () => {
    const row = await submitOk(a);
    expect((await op.post(`/api/operator/leaves/${row.id}/status`, { status: "approved" })).status).toBe(200);
    const res = await a.post(`/api/me/leaves/${row.id}/withdraw`);
    expect(res.status).toBe(409);
  });

  it("Undo of a withdraw puts the request back to Pending (audit + HR notified), HR can then decide it", async () => {
    const row = await submitOk(a);
    expect((await a.post(`/api/me/leaves/${row.id}/withdraw`)).status).toBe(200);
    const res = await a.post(`/api/me/leaves/${row.id}/restore`);
    expect(res.status).toBe(200);
    expect((await json<Row>(res)).status).toBe("pending");

    const [stored] = await db.select().from(leaveRequest).where(eq(leaveRequest.id, row.id));
    expect(stored).toMatchObject({ status: "pending", withdrawnAt: null, workingDays: "5.0" });
    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, row.id));
    expect(audits.map((x) => x.action)).toContain("leave.restoreWithdrawn");
    const notes = await db.select().from(notification).where(eq(notification.leaveRequestId, row.id));
    expect(notes.map((n) => n.kind).sort()).toEqual(["submitted", "submitted", "withdrawn"]);

    expect((await op.post(`/api/operator/leaves/${row.id}/status`, { status: "approved" })).status).toBe(200);
    // Once decided, a second Undo is refused.
    const again = await a.post(`/api/me/leaves/${row.id}/restore`);
    expect(again.status).toBe(409);
    expect((await json<ErrorBody>(again)).code).toBe("portal.errors.undoExpired");
  });

  it("Undo is refused after the window, on a request never withdrawn, and on someone else's leave", async () => {
    const row = await submitOk(a);
    expect((await a.post(`/api/me/leaves/${row.id}/restore`)).status).toBe(409); // still pending

    expect((await a.post(`/api/me/leaves/${row.id}/withdraw`)).status).toBe(200);
    expect((await b.post(`/api/me/leaves/${row.id}/restore`)).status).toBe(404);

    await db
      .update(leaveRequest)
      .set({ withdrawnAt: new Date(Date.now() - PORTAL_UNDO_WINDOW_MS - 1_000) })
      .where(eq(leaveRequest.id, row.id));
    const late = await a.post(`/api/me/leaves/${row.id}/restore`);
    expect(late.status).toBe(409);
    expect((await json<ErrorBody>(late)).code).toBe("portal.errors.undoExpired");
  });

  it("Undo re-runs the blocking checks: a leave submitted in between on the same days blocks it", async () => {
    const row = await submitOk(a);
    expect((await a.post(`/api/me/leaves/${row.id}/withdraw`)).status).toBe(200);
    await submitOk(a); // same week again
    const res = await a.post(`/api/me/leaves/${row.id}/restore`);
    expect(res.status).toBe(422);
    expect((await json<ErrorBody>(res)).code).toBe("leave.errors.blocked");
    const [stored] = await db.select().from(leaveRequest).where(eq(leaveRequest.id, row.id));
    expect(stored!.status).toBe("cancelled");
  });

  it("withdraw vs approve in parallel: exactly one wins, the other gets 409", async () => {
    const spans = [
      { startDate: "2027-04-05", endDate: "2027-04-06" },
      { startDate: "2027-05-04", endDate: "2027-05-05" },
      { startDate: "2027-06-08", endDate: "2027-06-09" },
    ];
    for (const span of spans) {
      const row = await submitOk(a, span);
      const [w, ap] = await Promise.all([
        a.post(`/api/me/leaves/${row.id}/withdraw`),
        op.post(`/api/operator/leaves/${row.id}/status`, { status: "approved" }),
      ]);
      expect([w.status, ap.status].sort()).toEqual([200, 409]);
      const [stored] = await db.select().from(leaveRequest).where(eq(leaveRequest.id, row.id));
      const ledger = await db.select().from(ledgerEntry).where(eq(ledgerEntry.leaveRequestId, row.id));
      if (w.status === 200) {
        expect(stored!.status).toBe("cancelled");
        expect(ledger).toHaveLength(0);
      } else {
        expect(stored!.status).toBe("approved");
        expect(ledger).toHaveLength(1);
      }
    }
  });

  it("an attachment can be removed only while the request is pending", async () => {
    const row = await submitOk(a, {}, new File([PDF], "a.pdf", { type: "application/pdf" }));
    const [file] = await json<{ id: string }[]>(await a.get(`/api/me/leaves/${row.id}/attachments`));
    expect((await op.post(`/api/operator/leaves/${row.id}/status`, { status: "approved" })).status).toBe(200);
    const blocked = await a.del(`/api/me/attachments/${file!.id}`);
    expect(blocked.status).toBe(409);
    expect((await json<ErrorBody>(blocked)).code).toBe("portal.errors.notPending");

    const row2 = await submitOk(a, { startDate: "2027-05-03", endDate: "2027-05-03" }, new File([PDF], "b.pdf", { type: "application/pdf" }));
    const [file2] = await json<{ id: string }[]>(await a.get(`/api/me/leaves/${row2.id}/attachments`));
    expect((await a.del(`/api/me/attachments/${file2!.id}`)).status).toBe(200);
    expect(await json(await a.get(`/api/me/leaves/${row2.id}/attachments`))).toEqual([]);
  });
});

describe("decisions: notifications and emails (sync rules 3-4)", () => {
  it("approve writes an in-app notification, sends the email and records it", async () => {
    const row = await submitOk(a, { note: "private note" });
    expect((await op.post(`/api/operator/leaves/${row.id}/status`, { status: "approved" })).status).toBe(200);
    await settleBackgroundJobs();

    const notes = await db
      .select()
      .from(notification)
      .where(and(eq(notification.leaveRequestId, row.id), eq(notification.recipient, "employee")));
    expect(notes.map((n) => `${n.kind}/${n.channel}`).sort()).toEqual(["approved/email", "approved/in_app"]);
    expect(notes.find((n) => n.channel === "email")!.sentAt).not.toBeNull();

    expect(testOutbox).toHaveLength(1);
    expect(testOutbox[0]!.to).toBe("alice@test.local");
    expect(testOutbox[0]!.subject).toBe("Your leave request was approved");
    expect(testOutbox[0]!.text).toContain("01/03/2027");
    expect(testOutbox[0]!.text).not.toContain("private note");
  });

  it("decision emails never carry the leave type or the reject reason (they stay behind the login)", async () => {
    const row = await submitOk(a);
    await op.post(`/api/operator/leaves/${row.id}/status`, { status: "rejected", reason: "Inventory week" });
    await settleBackgroundJobs();
    expect(testOutbox).toHaveLength(1);
    const mail = testOutbox[0]!;
    expect(mail.subject).toBe("Your leave request was declined");
    for (const body of [mail.text, mail.html]) {
      expect(body).not.toContain("Inventory week");
      expect(body).not.toContain("Paid leave");
      expect(body).toContain("Sign in to see the details.");
    }
    // The reason is still shown to the employee in the portal.
    const mine = (await json(await a.get("/api/me/leaves"))) as Array<{ id: string; rejectReason: string | null }>;
    expect(mine.find((l) => l.id === row.id)?.rejectReason).toBe("Inventory week");
  });

  it("no email for a code-only employee (in-app notification only)", async () => {
    const coded = await createEmployee({ fullName: "Code Only", employeeCode: "CODE-9", email: null, departmentId: empA.departmentId });
    await giveOpening(coded.id, types.paid.id, "20.0");
    const c = await signedInEmployee(op, coded.id);
    const row = await submitOk(c);
    expect((await op.post(`/api/operator/leaves/${row.id}/status`, { status: "approved" })).status).toBe(200);
    await settleBackgroundJobs();
    expect(testOutbox).toHaveLength(0);
    const notes = await db.select().from(notification).where(eq(notification.recipientEmployeeId, coded.id));
    expect(notes.map((n) => n.channel)).toEqual(["in_app"]);
  });

  it("dashboard shows the decision banner until it is read, plus balances and lists", async () => {
    const row = await submitOk(a);
    await submitOk(a, { startDate: "2027-06-07", endDate: "2027-06-07" }); // stays pending
    await op.post(`/api/operator/leaves/${row.id}/status`, { status: "approved" });

    type Dash = {
      me: { fullName: string };
      balances: { leaveTypeId: string; balance: number; taken: number; pending: number; available: number }[];
      pending: Row[];
      upcoming: Row[];
      decision: { notificationId: string; kind: string; leave: { id: string; status: string } } | null;
      nextHolidays: unknown[];
    };
    const dash = await json<Dash>(await a.get("/api/me/dashboard"));
    expect(dash.me.fullName).toBe("Alice A");
    // Paid: opening 20, the March leave (−5) is dated in the future so not in today's balance.
    expect(dash.balances).toEqual([
      expect.objectContaining({ leaveTypeId: types.paid.id, balance: 20, pending: 1, available: 19 }),
    ]);
    expect(dash.pending).toHaveLength(1);
    expect(dash.upcoming.map((l) => l.id)).toEqual([row.id]);
    expect(dash.decision).toMatchObject({ kind: "approved", leave: { id: row.id, status: "approved" } });

    await a.post(`/api/me/notifications/${dash.decision!.notificationId}/read`);
    expect((await json<Dash>(await a.get("/api/me/dashboard"))).decision).toBeNull();
  });

  it("operator edit of a portal request marks it changed by HR and notifies the employee", async () => {
    const row = await submitOk(a);
    const res = await op.patch(`/api/operator/leaves/${row.id}`, { leaveTypeId: types.paid.id, startDate: "2027-03-01", endDate: "2027-03-04" });
    expect(res.status).toBe(200);
    const mine = await json<Row[]>(await a.get("/api/me/leaves"));
    expect(mine[0]).toMatchObject({ id: row.id, changedByHr: true, workingDays: 4 });
    const notes = await db.select().from(notification).where(eq(notification.recipientEmployeeId, empA.id));
    expect(notes.map((n) => n.kind)).toEqual(["changed"]);
  });

  it("operator-logged leave shows as added by HR", async () => {
    await opApproved(empA.id, WEEK);
    const [row] = await json<Row[]>(await a.get("/api/me/leaves"));
    expect(row).toMatchObject({ source: "operator", addedByHr: true });
  });
});

describe("GET /me/reference", () => {
  it("returns work days, active leave types, holidays in range and the negative settings", async () => {
    const res = await json<{ workDays: number; leaveTypes: { code: string }[]; settings: Record<string, unknown> }>(
      await a.get("/api/me/reference?from=2027-01-01&to=2027-12-31"),
    );
    expect(res.workDays).toBeGreaterThan(0);
    expect(res.leaveTypes.map((t) => t.code)).toEqual(["paid", "comp_rest", "sick", "unpaid"]);
    expect(Object.keys(res.settings).sort()).toEqual(["allowNegative", "negativeLimitDays"]);
    expect(JSON.stringify(res)).not.toContain("Bruno");
  });
});
