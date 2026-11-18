// Step 5 verification: live sync (stack §2, spec 4.3). Events are published after commit, carry
// ids only, reach the operator channel and the owner's channel only; GET /api/events streams SSE.
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "../src/auth/rateLimit";
import { db, sql as pg } from "../src/db/client";
import { leaveRequest, ledgerEntry, user } from "../src/db/schema";
import {
  MAX_STREAMS_PER_USER,
  employeeChannel,
  openStreamCount,
  subscribe,
  type LeaveEvent,
} from "../src/realtime/bus";
import { settleBackgroundJobs } from "../src/services/backgroundJobs";
import { TestClient } from "./client";
import { createEmployee, resetDb } from "./db";
import { createLeaveTypes, json, signedInEmployee, signedInOperator } from "./operator";

type Types = Awaited<ReturnType<typeof createLeaveTypes>>;

let op: TestClient;
let types: Types;
let empA: Awaited<ReturnType<typeof createEmployee>>;
let empB: Awaited<ReturnType<typeof createEmployee>>;
let a: TestClient;
const unsubscribers: (() => void)[] = [];

/** Records events per channel. `committed` checks, from a separate connection, that the request
 * row is already visible when the event fires, i.e. the event was published after commit. */
function listen(channel: Parameters<typeof subscribe>[0][number]) {
  const events: LeaveEvent[] = [];
  const committed: Promise<boolean>[] = [];
  unsubscribers.push(
    subscribe([channel], (e) => {
      events.push(e);
      committed.push(
        db
          .select({ id: leaveRequest.id })
          .from(leaveRequest)
          .where(eq(leaveRequest.id, e.leaveRequestId))
          .then((rows) => rows.length === 1),
      );
    }),
  );
  return { events, committed };
}

function submit(c: TestClient, span = { startDate: "2027-03-01", endDate: "2027-03-02" }, leaveTypeId = types.paid.id) {
  const f = new FormData();
  f.append("data", JSON.stringify({ leaveTypeId, ...span }));
  return c.upload("/api/me/leaves", f);
}

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  op = await signedInOperator();
  types = await createLeaveTypes();
  empA = await createEmployee({ fullName: "Alice A", employeeCode: "A-1", email: "alice@test.local" });
  empB = await createEmployee({ fullName: "Bruno B", employeeCode: "B-1", email: "bruno@test.local", departmentId: empA.departmentId });
  await db.insert(ledgerEntry).values({
    employeeId: empA.id,
    leaveTypeId: types.paid.id,
    entryType: "opening",
    days: "20.0",
    effectiveDate: "2024-01-01",
    periodKey: "opening",
  });
  a = await signedInEmployee(op, empA.id);
});

afterEach(() => {
  while (unsubscribers.length) unsubscribers.pop()!();
});

afterAll(async () => {
  await settleBackgroundJobs();
  await pg.end();
});

describe("bus", () => {
  it("submit / approve / withdraw reach the operator and the owner only, with ids only, after commit", async () => {
    const operator = listen("operator");
    const ownA = listen(employeeChannel(empA.id));
    const teammate = listen(employeeChannel(empB.id));

    const first = await json<{ id: string }>(await submit(a));
    expect((await op.post(`/api/operator/leaves/${first.id}/status`, { status: "approved" })).status).toBe(200);
    const second = await json<{ id: string }>(await submit(a, { startDate: "2027-04-05", endDate: "2027-04-05" }));
    expect((await a.post(`/api/me/leaves/${second.id}/withdraw`)).status).toBe(200);

    const expected = [
      { type: "leave.submitted", leaveRequestId: first.id, employeeId: empA.id },
      { type: "leave.decided", leaveRequestId: first.id, employeeId: empA.id },
      { type: "leave.submitted", leaveRequestId: second.id, employeeId: empA.id },
      { type: "leave.withdrawn", leaveRequestId: second.id, employeeId: empA.id },
    ];
    expect(operator.events).toEqual(expected);
    expect(ownA.events).toEqual(expected);
    expect(teammate.events).toEqual([]);
    for (const e of operator.events) expect(Object.keys(e).sort()).toEqual(["employeeId", "leaveRequestId", "type"]);
    expect(await Promise.all(operator.committed)).toEqual([true, true, true, true]);
  });

  it("a blocked submit or a failed decision publishes nothing", async () => {
    const operator = listen("operator");
    expect((await submit(a, { startDate: "2027-03-06", endDate: "2027-03-07" })).status).toBe(422); // weekend
    const row = await json<{ id: string }>(await submit(a));
    expect((await a.post(`/api/me/leaves/${row.id}/withdraw`)).status).toBe(200);
    expect((await op.post(`/api/operator/leaves/${row.id}/status`, { status: "approved" })).status).toBe(409);
    expect(operator.events.map((e) => e.type)).toEqual(["leave.submitted", "leave.withdrawn"]);
  });

  it("operator create, edit, delete and restore publish leave.changed to the owner", async () => {
    const ownA = listen(employeeChannel(empA.id));
    const created = await json<{ id: string }>(
      await op.post("/api/operator/leaves", { employeeId: empA.id, leaveTypeId: types.unpaid.id, startDate: "2027-05-03", endDate: "2027-05-03" }),
    );
    await op.patch(`/api/operator/leaves/${created.id}`, { leaveTypeId: types.unpaid.id, startDate: "2027-05-03", endDate: "2027-05-04" });
    await op.del(`/api/operator/leaves/${created.id}`);
    await op.post(`/api/operator/leaves/${created.id}/restore`);
    expect(ownA.events.map((e) => e.type)).toEqual(["leave.changed", "leave.changed", "leave.changed", "leave.changed"]);
  });
});

describe("GET /api/events", () => {
  const decoder = new TextDecoder();

  async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string): Promise<string> {
    let text = "";
    const deadline = Date.now() + 5000;
    while (!text.includes(needle)) {
      const left = deadline - Date.now();
      const chunk = await Promise.race([
        reader.read(),
        new Promise<null>((r) => setTimeout(() => r(null), Math.max(left, 0))),
      ]);
      if (chunk === null) throw new Error(`timed out waiting for ${needle}; got ${text}`);
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    return text;
  }

  it("is 401 when signed out", async () => {
    const res = await new TestClient().get("/api/events");
    expect(res.status).toBe(401);
  });

  it("streams to a signed-in operator: headers, first ping, then a leave event", async () => {
    const res = await op.get("/api/events");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    expect(await readUntil(reader, "event: ping")).toContain("event: ping");

    const row = await json<{ id: string }>(await submit(a));
    const text = await readUntil(reader, "leave.submitted");
    expect(text).toContain("event: leave.submitted");
    expect(text).toContain(`data: {"type":"leave.submitted","leaveRequestId":"${row.id}","employeeId":"${empA.id}"}`);
    await reader.cancel();
  });

  it("an employee stream carries only that employee's events", async () => {
    const b = await signedInEmployee(op, empB.id);
    const res = await b.get("/api/events");
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await readUntil(reader, "event: ping");

    expect((await submit(a)).status).toBe(201); // Alice's event must not reach Bruno
    const ownRes = await submit(b, { startDate: "2027-03-01", endDate: "2027-03-01" }, types.unpaid.id);
    expect(ownRes.status).toBe(201);
    const own = await json<{ id: string }>(ownRes);
    const text = await readUntil(reader, own.id);
    expect(text).not.toContain(empA.id);
    expect(text.match(/event: leave\./g)).toHaveLength(1);
    await reader.cancel();
  });

  /** Resolves true when the server ends the stream within `ms` (far below the 25 s heartbeat). */
  async function endsWithin(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) return false;
      const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), left))]);
      if (chunk === null) return false;
      if (chunk.done) return true;
    }
  }

  const aliceUserId = async () => (await db.select({ id: user.id }).from(user).where(eq(user.employeeId, empA.id)))[0]!.id;

  it("archiving an employee closes their open stream at once, not at the next heartbeat (verify-spec item 5)", async () => {
    const userId = await aliceUserId();
    const res = await a.get("/api/events");
    const reader = res.body!.getReader();
    await readUntil(reader, "event: ping");
    expect(openStreamCount(userId)).toBe(1);

    expect((await op.post(`/api/operator/employees/${empA.id}/archive`)).status).toBe(200);
    expect(await endsWithin(reader, 2000)).toBe(true);
    await vi.waitFor(() => expect(openStreamCount(userId)).toBe(0));
    expect((await a.get("/api/events")).status).toBe(401); // and it cannot reopen
  });

  it(`a user keeps at most ${MAX_STREAMS_PER_USER} streams: one more closes the oldest`, async () => {
    const userId = await aliceUserId();
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
    for (let i = 0; i <= MAX_STREAMS_PER_USER; i++) {
      const reader = (await a.get("/api/events")).body!.getReader();
      await readUntil(reader, "event: ping");
      readers.push(reader);
    }
    expect(await endsWithin(readers[0]!, 2000)).toBe(true); // the oldest was closed
    await vi.waitFor(() => expect(openStreamCount(userId)).toBe(MAX_STREAMS_PER_USER));
    for (const r of readers.slice(1)) await r.cancel();
  });
});
