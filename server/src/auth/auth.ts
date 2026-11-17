// Better Auth configuration (stack §2, spec 2.5).
//
// HTTP surface: Better Auth's own router is NOT mounted. Every auth action goes through our
// routes (routes/session.ts, routes/operator/access.ts), which add lockout, the common-password
// check and the 12-hour session rule, and then call auth.api.* on the server.
import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/client";
import { account, session, user, verification } from "../db/schema";
import { env } from "../env";
import { sendMail } from "../services/email";
import { resetEmail } from "../services/emailTemplates";
import { companyMailContext } from "./mailContext";
import { hashPassword, verifyPassword } from "./password";

export const RESET_TOKEN_TTL_SECONDS = 30 * 60; // spec 2.5: reset link valid 30 minutes
export const INVITE_TOKEN_TTL_SECONDS = 48 * 60 * 60; // spec 2.5: set-password link valid 48 hours
export const REMEMBERED_SESSION_SECONDS = 30 * 24 * 60 * 60; // "Keep me signed in": 30 days
export const BROWSER_SESSION_SECONDS = 12 * 60 * 60; // otherwise: 12 hours (and a browser-session cookie)

export const setPasswordUrl = (token: string, kind: "invite" | "reset") =>
  `${env.APP_URL}/set-password?token=${encodeURIComponent(token)}&kind=${kind}`;

export const auth = betterAuth({
  appName: "Leave",
  baseURL: env.APP_URL,
  basePath: "/api/auth",
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL],
  telemetry: { enabled: false },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // accounts come from operator invites only
    autoSignIn: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    password: { hash: hashPassword, verify: verifyPassword },
    resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
    revokeSessionsOnPasswordReset: true,
    onPasswordReset: async ({ user: u }) => {
      // A chosen password ends the forced-change state and clears any lockout.
      await db
        .update(user)
        .set({ mustChangePassword: false, failedAttempts: 0, lockedUntil: null })
        .where(eq(user.id, u.id));
    },
    // Not awaited: known and unknown emails must answer in the same time (no enumeration), and
    // delivery errors are never surfaced to the requester.
    sendResetPassword: async ({ user: u, token }) => {
      void companyMailContext()
        .then((ctx) => sendMail(resetEmail(ctx.lang, { to: u.email, name: u.name, url: setPasswordUrl(token, "reset") })))
        .catch((err: unknown) => console.error("[auth] reset email failed", err instanceof Error ? err.message : "unknown"));
    },
  },
  session: {
    expiresIn: REMEMBERED_SESSION_SECONDS,
    updateAge: 24 * 60 * 60,
  },
  user: {
    additionalFields: {
      role: { type: "string", required: false, defaultValue: "employee", input: false },
      employeeId: { type: "string", required: false, input: false },
      mustChangePassword: { type: "boolean", required: false, defaultValue: false, input: false },
      failedAttempts: { type: "number", required: false, defaultValue: 0, input: false, returned: false },
      lockedUntil: { type: "date", required: false, input: false, returned: false },
      lastLoginAt: { type: "date", required: false, input: false, returned: false },
    },
  },
  verification: {
    storeIdentifier: "hashed", // reset and invite tokens are never stored in clear
  },
  advanced: {
    useSecureCookies: env.NODE_ENV === "production",
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
  },
});

export type Auth = typeof auth;
