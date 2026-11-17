// /api/operator/employees/:employeeId/*: portal account management (spec 2.5).
// Operator-only: guarded by requireOperator in routes/operator/index.ts. (Operator routes may take an employee id from the URL; portal routes may not.)
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
  AccountError,
  inviteEmployee,
  issueTemporaryPassword,
  setPortalAccess,
  signOutEmployeeEverywhere,
} from "../../auth/accounts";
import type { OperatorEnv } from "../../auth/middleware";

const params = z.object({ employeeId: z.string().uuid() });

function accountErrorResponse(err: unknown) {
  if (err instanceof AccountError) return { body: { code: err.code }, status: err.status } as const;
  throw err;
}

export const operatorAccessRoutes = new Hono<OperatorEnv>()
  .post("/:employeeId/invite", zValidator("param", params), async (c) => {
    try {
      const result = await inviteEmployee(c.req.valid("param").employeeId, c.var.auth.userId);
      return c.json(result, 200);
    } catch (err) {
      const r = accountErrorResponse(err);
      return c.json(r.body, r.status);
    }
  })
  .post("/:employeeId/temporary-password", zValidator("param", params), async (c) => {
    try {
      const result = await issueTemporaryPassword(c.req.valid("param").employeeId, c.var.auth.userId);
      // Shown once to the operator to hand over; never stored or logged in clear.
      c.header("cache-control", "no-store");
      return c.json(result, 200);
    } catch (err) {
      const r = accountErrorResponse(err);
      return c.json(r.body, r.status);
    }
  })
  .put(
    "/:employeeId/portal-access",
    zValidator("param", params),
    zValidator("json", z.object({ enabled: z.boolean() })),
    async (c) => {
      try {
        await setPortalAccess(c.req.valid("param").employeeId, c.req.valid("json").enabled, c.var.auth.userId);
        return c.json({ ok: true as const }, 200);
      } catch (err) {
        const r = accountErrorResponse(err);
        return c.json(r.body, r.status);
      }
    },
  )
  .post("/:employeeId/sign-out-everywhere", zValidator("param", params), async (c) => {
    await signOutEmployeeEverywhere(c.req.valid("param").employeeId, c.var.auth.userId);
    return c.json({ ok: true as const }, 200);
  });
