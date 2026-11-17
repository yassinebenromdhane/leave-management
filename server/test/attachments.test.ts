// Step 3 verification: attachments (spec 1.2): type by MIME + magic bytes, 10 MB cap, one live
// attachment per leave, access-checked download.
import { ATTACHMENT_MAX_BYTES } from "@leave/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "../src/auth/rateLimit";
import { db, sql as pg } from "../src/db/client";
import { attachment, auditLog, leaveRequest } from "../src/db/schema";
import { TestClient } from "./client";
import { createEmployee, resetDb } from "./db";
import { createLeaveTypes, json, signedInEmployee, signedInOperator } from "./operator";

// A real 1×1 PNG.
const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
);
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

let op: TestClient;
let leaveId: string;
let owner: Awaited<ReturnType<typeof createEmployee>>;

const form = (bytes: Uint8Array, name: string, type: string) => {
  const f = new FormData();
  f.append("file", new File([bytes], name, { type }));
  return f;
};
const upload = (bytes: Uint8Array, name: string, type: string) =>
  op.upload(`/api/operator/leaves/${leaveId}/attachments`, form(bytes, name, type));

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  op = await signedInOperator();
  const types = await createLeaveTypes();
  owner = await createEmployee({ employeeCode: "OWN-1", email: "owner@test.local" });
  const res = await op.post("/api/operator/leaves", {
    employeeId: owner.id,
    leaveTypeId: types.sick.id,
    startDate: "2025-03-03",
    endDate: "2025-03-04",
  });
  expect(res.status).toBe(201);
  const leave = await json<{ id: string; hasWarning: boolean }>(res);
  expect(leave.hasWarning).toBe(true); // certificate missing
  leaveId = leave.id;
});

afterAll(async () => {
  await pg.end();
});

describe("upload", () => {
  it("rejects a PDF sent as image/png and an unsupported type with 415", async () => {
    const mismatch = await upload(PDF, "scan.png", "image/png");
    expect(mismatch.status).toBe(415);
    expect(await mismatch.json()).toEqual({ code: "attachments.errors.type" });
    const gif = await upload(new TextEncoder().encode("GIF89a...."), "x.gif", "image/gif");
    expect(gif.status).toBe(415);
    expect(await db.select().from(attachment)).toHaveLength(0);
  });

  it("rejects files over 10 MB with 413", async () => {
    const big = new Uint8Array(ATTACHMENT_MAX_BYTES + 1024 * 1024);
    big.set(PDF);
    const res = await upload(big, "big.pdf", "application/pdf");
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ code: "attachments.errors.tooLarge" });
  });

  it("accepts a small PNG, clears the missing-attachment warning and audits metadata only", async () => {
    const res = await upload(PNG, "../../etc/certif\u0007icate.png", "image/png");
    expect(res.status).toBe(201);
    const created = await json<{ id: string; fileName: string; mimeType: string; sizeBytes: number }>(res);
    expect(created).toMatchObject({ fileName: "certificate.png", mimeType: "image/png", sizeBytes: PNG.byteLength });

    const [leave] = await db.select().from(leaveRequest).where(eq(leaveRequest.id, leaveId));
    expect(leave!.hasWarning).toBe(false);
    const detail = await json<{ attachmentCount: number; attachments: unknown[] }>(await op.get(`/api/operator/leaves/${leaveId}`));
    expect(detail.attachmentCount).toBe(1);
    expect(detail.attachments).toHaveLength(1);

    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, "attachment.upload"));
    expect(JSON.stringify(audit!.afterJson)).not.toContain("storageKey");
  });

  it("a second upload replaces (soft-deletes) the first", async () => {
    const first = await json<{ id: string }>(await upload(PNG, "a.png", "image/png"));
    const second = await json<{ id: string }>(await upload(PDF, "b.pdf", "application/pdf"));
    const rows = await db.select().from(attachment).where(eq(attachment.leaveRequestId, leaveId));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === first.id)!.deletedAt).not.toBeNull();
    expect(rows.find((r) => r.id === second.id)!.deletedAt).toBeNull();
    expect((await op.get(`/api/files/${first.id}`)).status).toBe(404);
  });

  it("DELETE soft-deletes with audit and brings the warning back", async () => {
    const created = await json<{ id: string }>(await upload(PNG, "a.png", "image/png"));
    expect((await op.del(`/api/operator/attachments/${created.id}`)).status).toBe(200);
    const [row] = await db.select().from(attachment).where(eq(attachment.id, created.id));
    expect(row!.deletedAt).not.toBeNull();
    const [leave] = await db.select().from(leaveRequest).where(eq(leaveRequest.id, leaveId));
    expect(leave!.hasWarning).toBe(true);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "attachment.delete"))).toHaveLength(1);
    expect((await op.del(`/api/operator/attachments/${created.id}`)).status).toBe(404);
  });
});

describe("download", () => {
  it("operator and owning employee can download; another employee gets 404", async () => {
    const created = await json<{ id: string }>(await upload(PNG, "certificat médical.png", "image/png"));

    const res = await op.get(`/api/files/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''certificat%20m%C3%A9dical.png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);

    const ownerClient = await signedInEmployee(op, owner.id);
    expect((await ownerClient.get(`/api/files/${created.id}`)).status).toBe(200);

    const stranger = await createEmployee({ employeeCode: "OTH-1", email: "other@test.local" });
    const strangerClient = await signedInEmployee(op, stranger.id);
    expect((await strangerClient.get(`/api/files/${created.id}`)).status).toBe(404);

    expect((await new TestClient().get(`/api/files/${created.id}`)).status).toBe(401);
    expect((await op.get("/api/files/00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});
