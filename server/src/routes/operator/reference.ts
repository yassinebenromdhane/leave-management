// /api/operator/reference and /api/operator/departments (operator only; guarded by the
// operator router in routes/operator/index.ts).
import { departmentInputSchema, referenceQuerySchema } from "@leave/shared";
import { Hono } from "hono";
import type { OperatorEnv } from "../../auth/middleware";
import { createDepartment, getReference } from "../../domain/referenceService";
import { validate } from "../validate";

export const referenceRoutes = new Hono<OperatorEnv>()
  .get("/reference", validate("query", referenceQuerySchema), async (c) =>
    c.json(await getReference(c.req.valid("query")), 200),
  )
  .post("/departments", validate("json", departmentInputSchema), async (c) =>
    c.json(await createDepartment(c.req.valid("json"), c.var.auth.userId), 201),
  );
