// /api/session/*: sign-in, current user, sign-out, change, forgot and reset password (spec 2.5).
// Login errors are generic and identical for unknown account, wrong password, locked account and
// disabled portal access, with the same Argon2 cost on every path (no account enumeration).
import { zValidator } from "@hono/zod-validator";
import {
  AUTH_ERRORS,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  type SessionUser,
} from "@leave/shared";
import { and, eq, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { auth, BROWSER_SESSION_SECONDS } from "../auth/auth";
import { isCommonPassword } from "../auth/commonPasswords";
import { recordFailedAttempt, recordSuccessfulLogin, reserveAttempt } from "../auth/lockout";
import { rateLimit } from "../auth/rateLimit";
import { employeeMayUsePortal, loadAuthUser } from "../auth/middleware";
import { burnPasswordCheck } from "../auth/password";
import { db } from "../db/client";
import { employee, session, user } from "../db/schema";

const invalidCredentials = { code: AUTH_ERRORS.invalidCredentials } as const;

/** Copies Better Auth's Set-Cookie headers onto our response. */
function forwardCookies(c: Context, res: Response): void {
  for (const cookie of res.headers.getSetCookie()) c.header("set-cookie", cookie, { append: true });
}

async function findLoginUser(identifier: string) {
  const columns = {
    id: user.id,
    email: user.email,
    role: user.role,
    employeeId: user.employeeId,
    lockedUntil: user.lockedUntil,
  };
  if (identifier.includes("@")) {
    const [u] = await db
      .select(columns)
      .from(user)
      .where(sql`lower(${user.email}) = ${identifier.toLowerCase()}`)
      .limit(1);
    return u;
  }
  const [u] = await db
    .select(columns)
    .from(user)
    .innerJoin(employee, eq(employee.id, user.employeeId))
    .where(eq(employee.employeeCode, identifier))
    .limit(1);
  return u;
}

async function callAuth(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    // auth.api may throw APIError instead of returning an error Response
    const status = typeof err === "object" && err && "statusCode" in err ? Number(err.statusCode) : 500;
    return new Response(null, { status: Number.isFinite(status) ? status : 500 });
  }
}

const MINUTE = 60_000;

export const sessionRoutes = new Hono()
  .use("/sign-in", rateLimit({ name: "sign-in", max: 20, windowMs: 5 * MINUTE }))
  .use("/forgot-password", rateLimit({ name: "forgot", max: 5, windowMs: 15 * MINUTE }))
  .use("/reset-password", rateLimit({ name: "reset", max: 10, windowMs: 15 * MINUTE }))
  .use("/change-password", rateLimit({ name: "change", max: 10, windowMs: 15 * MINUTE }))
  .post("/sign-in", zValidator("json", signInSchema), async (c) => {
    const { identifier, password, rememberMe } = c.req.valid("json");
    const u = await findLoginUser(identifier);

    const portalOk = u?.role === "operator" || (u?.employeeId != null && (await employeeMayUsePortal(u.employeeId)));
    const attempt = u && portalOk ? await reserveAttempt(u.id) : null;
    if (!u || attempt === null) {
      await burnPasswordCheck(password);
      return c.json(invalidCredentials, 401);
    }

    const res = await callAuth(() =>
      auth.api.signInEmail({
        body: { email: u.email, password, rememberMe },
        headers: c.req.raw.headers,
        asResponse: true,
      }),
    );
    if (!res.ok) {
      await recordFailedAttempt(u.id, attempt);
      return c.json(invalidCredentials, 401);
    }

    await recordSuccessfulLogin(u.id);
    const body = (await res.json()) as { token?: string };
    if (!rememberMe && body.token) {
      // Better Auth gives non-remembered sessions 24 h; spec 2.5 says 12 h. Such sessions are
      // never auto-extended (no refresh when the "don't remember" cookie is present).
      await db
        .update(session)
        .set({ expiresAt: new Date(Date.now() + BROWSER_SESSION_SECONDS * 1000) })
        .where(and(eq(session.token, body.token), eq(session.userId, u.id)));
    }
    forwardCookies(c, res);
    const [fresh] = await db
      .select({ mustChangePassword: user.mustChangePassword })
      .from(user)
      .where(eq(user.id, u.id));
    return c.json({ role: u.role, mustChangePassword: fresh?.mustChangePassword ?? false }, 200);
  })

  .get("/me", async (c) => {
    const u = await loadAuthUser(c);
    if (!u) return c.json({ code: AUTH_ERRORS.unauthenticated }, 401);
    if (u.role === "employee" && (!u.employeeId || !(await employeeMayUsePortal(u.employeeId)))) {
      return c.json({ code: AUTH_ERRORS.unauthenticated }, 401);
    }
    const me: SessionUser = u;
    return c.json(me, 200);
  })

  .post("/sign-out", async (c) => {
    const res = await callAuth(() => auth.api.signOut({ headers: c.req.raw.headers, asResponse: true }));
    forwardCookies(c, res);
    return c.json({ ok: true as const }, 200);
  })

  .post("/change-password", zValidator("json", changePasswordSchema), async (c) => {
    const u = await loadAuthUser(c);
    if (!u) return c.json({ code: AUTH_ERRORS.unauthenticated }, 401);
    const { currentPassword, newPassword } = c.req.valid("json");
    if (isCommonPassword(newPassword)) return c.json({ code: AUTH_ERRORS.commonPassword }, 400);

    // Spec 2.5: changing the password signs out the other devices. Better Auth issues a new
    // 30-day session for this device; it keeps the expiry of the session it replaces instead,
    // so a 12-hour session stays a 12-hour session.
    const current = await auth.api.getSession({ headers: c.req.raw.headers, query: { disableRefresh: true } });
    const res = await callAuth(() =>
      auth.api.changePassword({
        body: { currentPassword, newPassword, revokeOtherSessions: true },
        headers: c.req.raw.headers,
        asResponse: true,
      }),
    );
    if (!res.ok) return c.json({ code: AUTH_ERRORS.currentPasswordWrong }, 400);
    const body = (await res.clone().json()) as { token?: string | null };
    if (current && body.token) {
      await db
        .update(session)
        .set({ expiresAt: current.session.expiresAt })
        .where(and(eq(session.token, body.token), eq(session.userId, u.userId)));
    }
    await db.update(user).set({ mustChangePassword: false }).where(eq(user.id, u.userId));
    forwardCookies(c, res);
    return c.json({ ok: true as const }, 200);
  })

  .post("/forgot-password", zValidator("json", forgotPasswordSchema), async (c) => {
    const { email } = c.req.valid("json");
    // Same answer whether or not the email exists.
    await callAuth(() =>
      auth.api.requestPasswordReset({ body: { email }, headers: c.req.raw.headers, asResponse: true }),
    );
    return c.json({ ok: true as const }, 200);
  })

  .post("/reset-password", zValidator("json", resetPasswordSchema), async (c) => {
    const { token, newPassword } = c.req.valid("json");
    if (isCommonPassword(newPassword)) return c.json({ code: AUTH_ERRORS.commonPassword }, 400);
    const res = await callAuth(() =>
      auth.api.resetPassword({ body: { token, newPassword }, headers: c.req.raw.headers, asResponse: true }),
    );
    if (!res.ok) return c.json({ code: AUTH_ERRORS.invalidToken }, 400);
    return c.json({ ok: true as const }, 200);
  });
