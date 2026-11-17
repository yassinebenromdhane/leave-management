// Role middleware (spec 2.5, 4.3). Every protected route uses one of these.
// - requireOperator: the single operator account.
// - requireEmployee: an employee whose row is active with portal access. The employee id
//   comes from the session only and is exposed as c.var.auth.employeeId (invariant 5).
// Both refuse accounts that must change their password first.
import { AUTH_ERRORS } from "@leave/shared";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { db } from "../db/client";
import { employee } from "../db/schema";
import { auth } from "./auth";
import { revokeAllSessions } from "./sessions";

export type AuthUser = {
  userId: string;
  role: "operator" | "employee";
  name: string;
  employeeId: string | null;
  mustChangePassword: boolean;
};

export type OperatorEnv = { Variables: { auth: AuthUser & { role: "operator" } } };
export type EmployeeEnv = { Variables: { auth: AuthUser & { role: "employee"; employeeId: string } } };

/** Reads the Better Auth session cookie. Returns null when signed out or expired. */
export async function loadAuthUser(c: Context): Promise<AuthUser | null> {
  // disableRefresh: sessions never slide. Each lasts exactly what sign-in granted (12 h or
  // 30 days), whatever cookies a client chooses to send.
  const result = await auth.api.getSession({ headers: c.req.raw.headers, query: { disableRefresh: true } });
  if (!result) return null;
  const u = result.user as typeof result.user & {
    role?: string;
    employeeId?: string | null;
    mustChangePassword?: boolean;
  };
  if (u.role !== "operator" && u.role !== "employee") return null;
  return {
    userId: u.id,
    role: u.role,
    name: u.name,
    employeeId: u.employeeId ?? null,
    mustChangePassword: u.mustChangePassword === true,
  };
}

/** True when the employee row allows portal use right now (archiving cuts access immediately). */
export async function employeeMayUsePortal(employeeId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: employee.status, portalAccess: employee.portalAccess })
    .from(employee)
    .where(eq(employee.id, employeeId))
    .limit(1);
  return row?.status === "active" && row.portalAccess;
}

export const requireOperator = createMiddleware<OperatorEnv>(async (c, next) => {
  const u = await loadAuthUser(c);
  if (!u) return c.json({ code: AUTH_ERRORS.unauthenticated }, 401);
  if (u.role !== "operator") return c.json({ code: AUTH_ERRORS.forbidden }, 403);
  if (u.mustChangePassword) return c.json({ code: AUTH_ERRORS.mustChangePassword }, 403);
  c.set("auth", { ...u, role: "operator" });
  await next();
});

export const requireEmployee = createMiddleware<EmployeeEnv>(async (c, next) => {
  const u = await loadAuthUser(c);
  if (!u) return c.json({ code: AUTH_ERRORS.unauthenticated }, 401);
  if (u.role !== "employee" || !u.employeeId) return c.json({ code: AUTH_ERRORS.forbidden }, 403);
  if (!(await employeeMayUsePortal(u.employeeId))) {
    await revokeAllSessions(u.userId);
    return c.json({ code: AUTH_ERRORS.unauthenticated }, 401);
  }
  if (u.mustChangePassword) return c.json({ code: AUTH_ERRORS.mustChangePassword }, 403);
  c.set("auth", { ...u, role: "employee", employeeId: u.employeeId });
  await next();
});
