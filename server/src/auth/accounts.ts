// Account lifecycle driven by the operator (spec 2.5):
// - invite: creates the employee's login (no password yet) and emails a 48-hour set-password link
// - temporary password: for employees without email; must be changed at first login
// - portal access on/off and "sign out of all devices"
// - first operator account, created by the seed
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { account, employee, user, verification } from "../db/schema";
import { writeAudit } from "../domain/audit";
import { sendMail } from "../services/email";
import { inviteEmail } from "../services/emailTemplates";
import { auth, INVITE_TOKEN_TTL_SECONDS, setPasswordUrl } from "./auth";
import { companyMailContext } from "./mailContext";
import { generateTemporaryPassword, hashPassword } from "./password";
import { revokeAllSessions } from "./sessions";

export class AccountError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(code);
  }
}

const newId = () => randomBytes(18).toString("base64url");

/** Login email for employees without one; never deliverable, never shown. */
export const codeOnlyEmail = (employeeCode: string) => `${employeeCode.toLowerCase()}@employee-code.invalid`;

async function loadEmployee(employeeId: string) {
  const [row] = await db.select().from(employee).where(eq(employee.id, employeeId)).limit(1);
  if (!row) throw new AccountError("errors.notFound", 404);
  if (row.status !== "active") throw new AccountError("employees.errors.archived", 409);
  return row;
}

async function assertEmailFree(email: string, employeeId: string): Promise<void> {
  const [clash] = await db
    .select({ id: user.id })
    .from(user)
    .where(and(sql`lower(${user.email}) = ${email}`, sql`${user.employeeId} is distinct from ${employeeId}`))
    .limit(1);
  if (clash) throw new AccountError("employees.errors.emailInUse", 409);
}

/**
 * Invalidates every outstanding invite or reset link of this user. Call on re-invite, temporary
 * password, portal disable and login-email change (step 3), so an old link sent to a wrong or
 * former address can never be used.
 */
export async function revokePendingLinks(userId: string): Promise<void> {
  await db.delete(verification).where(eq(verification.value, userId));
}

/** Returns the employee's auth user id, creating the user row on first use. */
async function ensureEmployeeUser(emp: Awaited<ReturnType<typeof loadEmployee>>, loginEmail: string): Promise<string> {
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.employeeId, emp.id)).limit(1);
  if (existing) {
    await db.update(user).set({ email: loginEmail, name: emp.fullName }).where(eq(user.id, existing.id));
    return existing.id;
  }
  const id = newId();
  await db.insert(user).values({ id, name: emp.fullName, email: loginEmail, role: "employee", employeeId: emp.id });
  return id;
}

async function setCredentialPassword(userId: string, password: string): Promise<void> {
  const hashed = await hashPassword(password);
  const updated = await db
    .update(account)
    .set({ password: hashed })
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .returning({ id: account.id });
  if (updated.length === 0) {
    await db.insert(account).values({ id: newId(), userId, accountId: userId, providerId: "credential", password: hashed });
  }
}

/** Spec 2.5 "Invite": email with a set-password link valid 48 hours. Turns portal access on. */
export async function inviteEmployee(employeeId: string, actor: string): Promise<{ sentTo: string }> {
  const emp = await loadEmployee(employeeId);
  if (!emp.email) throw new AccountError("employees.errors.noEmail", 400);
  const email = emp.email.toLowerCase();

  await assertEmailFree(email, emp.id);
  const userId = await ensureEmployeeUser(emp, email);
  await revokePendingLinks(userId); // a re-invite cancels every earlier invite or reset link

  // Same token format as Better Auth's reset flow, so /reset-password consumes it (single use,
  // stored hashed through internalAdapter with verification.storeIdentifier = "hashed").
  const token = randomBytes(24).toString("base64url");
  const ctx = await auth.$context;
  await ctx.internalAdapter.createVerificationValue({
    identifier: `reset-password:${token}`,
    value: userId,
    expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_SECONDS * 1000),
  });

  await db.transaction(async (tx) => {
    await tx.update(employee).set({ portalAccess: true }).where(eq(employee.id, emp.id));
    await writeAudit(tx, {
      entity: "employee",
      entityId: emp.id,
      action: "portal.invite",
      actor,
      before: { portalAccess: emp.portalAccess },
      after: { portalAccess: true, invitedEmail: email },
    });
  });

  const mail = await companyMailContext();
  await sendMail(inviteEmail(mail.lang, { to: email, name: emp.fullName, company: mail.company, url: setPasswordUrl(token, "invite") }));
  return { sentTo: email };
}

/**
 * Spec 2.5 "Without email" and operator reset: issues a temporary password, revokes sessions,
 * and forces a new password at next login. Login is by employee code (or email if set).
 */
export async function issueTemporaryPassword(
  employeeId: string,
  actor: string,
): Promise<{ temporaryPassword: string; loginIdentifier: string }> {
  const emp = await loadEmployee(employeeId);
  if (!emp.employeeCode && !emp.email) throw new AccountError("employees.errors.noLoginIdentifier", 400);

  const loginEmail = emp.email ? emp.email.toLowerCase() : codeOnlyEmail(emp.employeeCode!);
  await assertEmailFree(loginEmail, emp.id);
  const userId = await ensureEmployeeUser(emp, loginEmail);
  await revokePendingLinks(userId);
  const temporaryPassword = generateTemporaryPassword();
  await setCredentialPassword(userId, temporaryPassword);
  await revokeAllSessions(userId);

  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ mustChangePassword: true, failedAttempts: 0, lockedUntil: null })
      .where(eq(user.id, userId));
    await tx.update(employee).set({ portalAccess: true }).where(eq(employee.id, emp.id));
    await writeAudit(tx, {
      entity: "employee",
      entityId: emp.id,
      action: "portal.temporaryPassword",
      actor,
      before: { portalAccess: emp.portalAccess },
      after: { portalAccess: true }, // never the password
    });
  });

  return { temporaryPassword, loginIdentifier: emp.employeeCode ?? loginEmail };
}

/** Spec 2.5 "Revocation": disable portal access (also signs out everywhere) or re-enable it. */
export async function setPortalAccess(employeeId: string, enabled: boolean, actor: string): Promise<void> {
  const [emp] = await db.select().from(employee).where(eq(employee.id, employeeId)).limit(1);
  if (!emp) throw new AccountError("errors.notFound", 404);
  await db.transaction(async (tx) => {
    await tx.update(employee).set({ portalAccess: enabled }).where(eq(employee.id, employeeId));
    await writeAudit(tx, {
      entity: "employee",
      entityId: employeeId,
      action: enabled ? "portal.enable" : "portal.disable",
      actor,
      before: { portalAccess: emp.portalAccess },
      after: { portalAccess: enabled },
    });
  });
  if (!enabled) {
    await signOutEmployeeEverywhere(employeeId, actor, false);
    const [u] = await db.select({ id: user.id }).from(user).where(eq(user.employeeId, employeeId)).limit(1);
    if (u) await revokePendingLinks(u.id);
  }
}

export async function signOutEmployeeEverywhere(employeeId: string, actor: string, audit = true): Promise<void> {
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.employeeId, employeeId)).limit(1);
  if (u) await revokeAllSessions(u.id);
  if (audit) {
    await writeAudit(db, { entity: "employee", entityId: employeeId, action: "portal.signOutEverywhere", actor });
  }
}

/** Creates the single operator account if none exists. Must change its password at first login. */
export async function ensureOperator(email: string, initialPassword: string): Promise<"created" | "exists"> {
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.role, "operator")).limit(1);
  if (existing) return "exists";
  const id = newId();
  await db.insert(user).values({
    id,
    name: "HR",
    email: email.toLowerCase(),
    emailVerified: true,
    role: "operator",
    mustChangePassword: true,
  });
  await setCredentialPassword(id, initialPassword);
  await writeAudit(db, { entity: "user", entityId: id, action: "operator.create", actor: "system", after: { email: email.toLowerCase() } });
  return "created";
}
