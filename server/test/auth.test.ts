// Step 2 verification (spec 2.5): sign-in, lockout, no enumeration, disabled sign-up,
// forced password change, invite and reset tokens, session lifetimes and revocation, roles.
import { AUTH_ERRORS } from "@leave/shared";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import { BROWSER_SESSION_SECONDS, REMEMBERED_SESSION_SECONDS } from "../src/auth/auth";
import { resetRateLimits } from "../src/auth/rateLimit";
import { db, sql as pg } from "../src/db/client";
import { account, auditLog, employee, session, user, verification } from "../src/db/schema";
import { testOutbox } from "../src/services/email";
import { ORIGIN, TestClient } from "./client";
import { createEmployee, createOperator, OPERATOR, resetDb } from "./db";
import { OPERATOR_NEW_PASSWORD, signedInOperator } from "./operator";

const NEW_PW = OPERATOR_NEW_PASSWORD;

const operatorClient = signedInOperator;

function tokenFromLastEmail(): string {
  const mail = testOutbox.at(-1);
  const m = mail?.text.match(/token=([^&\s]+)/);
  if (!m) throw new Error("no token in last email");
  return decodeURIComponent(m[1]!);
}

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  testOutbox.length = 0;
});

afterAll(async () => {
  await pg.end();
});

describe("Better Auth HTTP surface is closed", () => {
  it.each([
    ["POST", "/api/auth/sign-up/email"],
    ["POST", "/api/auth/sign-in/email"],
    ["POST", "/api/auth/reset-password"],
    ["GET", "/api/auth/get-session"],
  ])("%s %s is not reachable", async (method, path) => {
    const res = await app.request(path, {
      method,
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: method === "POST" ? JSON.stringify({ email: "x@test.local", password: "whatever-123", name: "x" }) : undefined,
    });
    expect(res.status).toBe(404);
    expect(await db.select().from(user)).toHaveLength(0);
  });
});

describe("sign-in", () => {
  it("operator signs in, must change password first, then reaches operator routes", async () => {
    await createOperator();
    const c = new TestClient();
    const res = await c.signIn(OPERATOR.email.toUpperCase(), OPERATOR.password);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "operator", mustChangePassword: true });

    const emp = await createEmployee();
    const gated = await c.post(`/api/operator/employees/${emp.id}/sign-out-everywhere`);
    expect(gated.status).toBe(403);
    expect(await gated.json()).toEqual({ code: AUTH_ERRORS.mustChangePassword });

    expect((await c.post("/api/session/change-password", { currentPassword: OPERATOR.password, newPassword: NEW_PW })).status).toBe(200);
    expect((await c.post(`/api/operator/employees/${emp.id}/sign-out-everywhere`)).status).toBe(200);

    const me = await c.get("/api/session/me");
    expect(await me.json()).toMatchObject({ role: "operator", mustChangePassword: false, employeeId: null });
  });

  it("unknown email, wrong password and locked account give the identical response", async () => {
    await createOperator();
    const bodies = [];
    const unknown = await new TestClient().signIn("nobody@test.local", "whatever-123");
    bodies.push([unknown.status, await unknown.json()]);
    const wrong = await new TestClient().signIn(OPERATOR.email, "wrong-password");
    bodies.push([wrong.status, await wrong.json()]);
    await db.update(user).set({ lockedUntil: new Date(Date.now() + 60_000) });
    const locked = await new TestClient().signIn(OPERATOR.email, OPERATOR.password);
    bodies.push([locked.status, await locked.json()]);
    for (const b of bodies) expect(b).toEqual([401, { code: AUTH_ERRORS.invalidCredentials }]);
  });

  it("locks for 15 minutes after 5 failures, even with the right password, then unlocks", async () => {
    await createOperator();
    for (let i = 0; i < 5; i++) {
      expect((await new TestClient().signIn(OPERATOR.email, `wrong-${i}-password`)).status).toBe(401);
    }
    const [locked] = await db.select().from(user);
    const minutes = (locked!.lockedUntil!.getTime() - Date.now()) / 60_000;
    // lockedUntil comes from PostgreSQL's clock; allow a few seconds of skew with Node's clock.
    expect(minutes).toBeGreaterThan(14.9);
    expect(minutes).toBeLessThan(15.1);

    expect((await new TestClient().signIn(OPERATOR.email, OPERATOR.password)).status).toBe(401);

    await db.update(user).set({ lockedUntil: new Date(Date.now() - 1000) });
    expect((await new TestClient().signIn(OPERATOR.email, OPERATOR.password)).status).toBe(200);
    const [after] = await db.select().from(user);
    expect(after).toMatchObject({ failedAttempts: 0, lockedUntil: null });
  });

  it("session lasts 12 h without 'keep me signed in' and 30 days with it", async () => {
    await createOperator();
    await new TestClient().signIn(OPERATOR.email, OPERATOR.password, false);
    await new TestClient().signIn(OPERATOR.email, OPERATOR.password, true);
    const rows = await db.select().from(session).orderBy(session.createdAt);
    const hours = rows.map((r) => Math.round((r.expiresAt.getTime() - Date.now()) / 3_600_000));
    expect(hours).toEqual([BROWSER_SESSION_SECONDS / 3600, REMEMBERED_SESSION_SECONDS / 3600]);
  });

  it("stores the password as an Argon2id hash", async () => {
    await createOperator();
    const [acc] = await db.select({ password: account.password }).from(account);
    expect(acc!.password).toMatch(/^\$argon2id\$/);
  });
});

describe("invite and reset tokens", () => {
  it("invite emails a 48 h single-use link, stored hashed; the employee then signs in", async () => {
    const op = await operatorClient();
    const emp = await createEmployee({ portalAccess: false });

    const res = await op.post(`/api/operator/employees/${emp.id}/invite`);
    expect(res.status).toBe(200);
    expect(testOutbox).toHaveLength(1);
    expect(testOutbox[0]!.to).toBe("ines@test.local");

    const token = tokenFromLastEmail();
    const [v] = await db.select().from(verification);
    expect(v!.identifier).not.toContain(token);
    const hours = (v!.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(47.9);
    expect(hours).toBeLessThanOrEqual(48);

    expect((await new TestClient().post("/api/session/reset-password", { token, newPassword: "password123" })).status).toBe(400);
    expect((await new TestClient().post("/api/session/reset-password", { token, newPassword: NEW_PW })).status).toBe(200);
    const reuse = await new TestClient().post("/api/session/reset-password", { token, newPassword: "another-password" });
    expect(reuse.status).toBe(400);
    expect(await reuse.json()).toEqual({ code: AUTH_ERRORS.invalidToken });

    const e = new TestClient();
    expect(await (await e.signIn("ines@test.local", NEW_PW)).json()).toEqual({ role: "employee", mustChangePassword: false });
    expect(await (await e.get("/api/me/profile")).json()).toEqual({ fullName: "Ines Test", department: expect.any(String), hireDate: "2024-01-01" });

    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, "portal.invite"));
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it("forgot-password answers the same for unknown emails and sends a 30-minute link to known ones", async () => {
    const op = await operatorClient();
    const emp = await createEmployee();
    await op.post(`/api/operator/employees/${emp.id}/invite`);
    await new TestClient().post("/api/session/reset-password", { token: tokenFromLastEmail(), newPassword: NEW_PW });
    testOutbox.length = 0;

    const unknown = await new TestClient().post("/api/session/forgot-password", { email: "nobody@test.local" });
    const known = await new TestClient().post("/api/session/forgot-password", { email: "INES@test.local" });
    expect([unknown.status, await unknown.json()]).toEqual([known.status, await known.json()]);
    await vi.waitFor(() => expect(testOutbox).toHaveLength(1)); // email is sent in the background

    const [v] = await db.select().from(verification).orderBy(sql`${verification.createdAt} desc`).limit(1);
    const minutes = (v!.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);
  });
});

describe("temporary password and employee code login", () => {
  it("employee without email logs in by code and must choose a new password", async () => {
    const op = await operatorClient();
    const emp = await createEmployee({ email: null, employeeCode: "EMP-042" });
    const res = await op.post(`/api/operator/employees/${emp.id}/temporary-password`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { temporaryPassword, loginIdentifier } = (await res.json()) as { temporaryPassword: string; loginIdentifier: string };
    expect(loginIdentifier).toBe("EMP-042");

    const e = new TestClient();
    expect(await (await e.signIn("EMP-042", temporaryPassword)).json()).toEqual({ role: "employee", mustChangePassword: true });
    expect((await e.get("/api/me/profile")).status).toBe(403);

    const common = await e.post("/api/session/change-password", { currentPassword: temporaryPassword, newPassword: "Password1" });
    expect(await common.json()).toEqual({ code: AUTH_ERRORS.commonPassword });
    const wrong = await e.post("/api/session/change-password", { currentPassword: "not-it-at-all", newPassword: NEW_PW });
    expect(await wrong.json()).toEqual({ code: AUTH_ERRORS.currentPasswordWrong });

    expect((await e.post("/api/session/change-password", { currentPassword: temporaryPassword, newPassword: NEW_PW })).status).toBe(200);
    expect((await e.get("/api/me/profile")).status).toBe(200);
  });
});

describe("session revocation", () => {
  async function activeEmployee() {
    const op = await operatorClient();
    const emp = await createEmployee();
    const { temporaryPassword } = (await (await op.post(`/api/operator/employees/${emp.id}/temporary-password`)).json()) as { temporaryPassword: string };
    const phone = new TestClient();
    await phone.signIn("ines@test.local", temporaryPassword, true);
    await phone.post("/api/session/change-password", { currentPassword: temporaryPassword, newPassword: NEW_PW });
    return { op, emp, phone };
  }

  it("password change signs out the other devices but keeps this one", async () => {
    const { phone } = await activeEmployee();
    const laptop = new TestClient();
    await laptop.signIn("ines@test.local", NEW_PW);
    expect((await laptop.get("/api/me/profile")).status).toBe(200);

    expect((await phone.post("/api/session/change-password", { currentPassword: NEW_PW, newPassword: "yet-another-pass" })).status).toBe(200);
    expect((await phone.get("/api/me/profile")).status).toBe(200);
    expect((await laptop.get("/api/me/profile")).status).toBe(401);
  });

  it("operator 'sign out everywhere' ends every session", async () => {
    const { op, emp, phone } = await activeEmployee();
    expect((await op.post(`/api/operator/employees/${emp.id}/sign-out-everywhere`)).status).toBe(200);
    expect((await phone.get("/api/me/profile")).status).toBe(401);
  });

  it("disabling portal access cuts access and blocks sign-in", async () => {
    const { op, emp, phone } = await activeEmployee();
    expect((await op.put(`/api/operator/employees/${emp.id}/portal-access`, { enabled: false })).status).toBe(200);
    expect((await phone.get("/api/me/profile")).status).toBe(401);
    expect((await new TestClient().signIn("ines@test.local", NEW_PW)).status).toBe(401);
  });

  it("archiving cuts access immediately, even with a live session", async () => {
    const { emp, phone } = await activeEmployee();
    await db.update(employee).set({ status: "archived" }).where(eq(employee.id, emp.id));
    expect((await phone.get("/api/me/profile")).status).toBe(401);
    const [u] = await db.select({ id: user.id }).from(user).where(eq(user.employeeId, emp.id));
    expect(await db.select().from(session).where(and(eq(session.userId, u!.id)))).toHaveLength(0);
  });
});

describe("roles", () => {
  it("anonymous gets 401, employee gets 403 on operator routes, operator gets 403 on portal routes", async () => {
    const op = await operatorClient();
    const emp = await createEmployee();
    expect((await new TestClient().post(`/api/operator/employees/${emp.id}/invite`)).status).toBe(401);
    expect((await new TestClient().get("/api/me/profile")).status).toBe(401);
    expect((await op.get("/api/me/profile")).status).toBe(403);

    await op.post(`/api/operator/employees/${emp.id}/invite`);
    await new TestClient().post("/api/session/reset-password", { token: tokenFromLastEmail(), newPassword: NEW_PW });
    const e = new TestClient();
    await e.signIn("ines@test.local", NEW_PW);
    expect((await e.post(`/api/operator/employees/${emp.id}/invite`)).status).toBe(403);
  });

  it("rejects cross-site form posts", async () => {
    const res = await app.request("/api/session/sign-in", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" },
      body: "identifier=x&password=y",
    });
    expect(res.status).toBe(403);
  });
});

describe("audit fixes (step 2 security review)", () => {
  it("parallel guesses cannot exceed 5 password checks", async () => {
    await createOperator();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => new TestClient().signIn(OPERATOR.email, `wrong-${i}-pw`)),
    );
    expect(results.every((r) => r.status === 401)).toBe(true);
    const [u] = await db.select().from(user);
    expect(u!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    // Even the right password is refused while locked.
    expect((await new TestClient().signIn(OPERATOR.email, OPERATOR.password)).status).toBe(401);
  });

  it("rate-limits sign-in per IP with 429", async () => {
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await new TestClient().signIn(`x${i}@test.local`, "whatever-123")).status;
    expect(last).toBe(429);
  });

  it("a password change keeps the 12-hour expiry of a non-remembered session", async () => {
    await createOperator();
    const c = new TestClient();
    await c.signIn(OPERATOR.email, OPERATOR.password, false);
    await c.post("/api/session/change-password", { currentPassword: OPERATOR.password, newPassword: NEW_PW });
    const rows = await db.select().from(session);
    expect(rows).toHaveLength(1);
    const hours = (rows[0]!.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeLessThanOrEqual(12);
    expect((await c.get("/api/session/me")).status).toBe(200);
  });

  it("sessions never slide: reading the session leaves expiresAt unchanged", async () => {
    await createOperator();
    const c = new TestClient();
    await c.signIn(OPERATOR.email, OPERATOR.password, true);
    // Simulate an old 30-day session that Better Auth would normally extend.
    const old = new Date(Date.now() + 2 * 24 * 3_600_000);
    await db.update(session).set({ expiresAt: old });
    await c.get("/api/session/me");
    const [row] = await db.select().from(session);
    expect(row!.expiresAt.getTime()).toBe(old.getTime());
  });

  it("re-inviting cancels the earlier invite link", async () => {
    const op = await operatorClient();
    const emp = await createEmployee();
    await op.post(`/api/operator/employees/${emp.id}/invite`);
    const first = tokenFromLastEmail();
    await op.post(`/api/operator/employees/${emp.id}/invite`);
    const second = tokenFromLastEmail();
    expect((await new TestClient().post("/api/session/reset-password", { token: first, newPassword: NEW_PW })).status).toBe(400);
    expect((await new TestClient().post("/api/session/reset-password", { token: second, newPassword: NEW_PW })).status).toBe(200);
  });

  it("disabling portal access cancels pending invite links", async () => {
    const op = await operatorClient();
    const emp = await createEmployee();
    await op.post(`/api/operator/employees/${emp.id}/invite`);
    const token = tokenFromLastEmail();
    await op.put(`/api/operator/employees/${emp.id}/portal-access`, { enabled: false });
    expect((await new TestClient().post("/api/session/reset-password", { token, newPassword: NEW_PW })).status).toBe(400);
  });
});
