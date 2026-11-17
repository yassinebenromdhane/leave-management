// /api/operator/employees: list, quick add, detail (balances + ledger + leaves), inline edit,
// archive / restore, manual adjustments. Operator only (routes/operator/index.ts).
import { adjustmentSchema, employeeCreateSchema, employeeListQuerySchema, employeeUpdateSchema } from "@leave/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { OperatorEnv } from "../../auth/middleware";
import {
  addAdjustment,
  archiveEmployee,
  createEmployee,
  getEmployeeDetail,
  listEmployees,
  restoreEmployee,
  updateEmployee,
} from "../../domain/employeeService";
import { validate } from "../validate";

const idParam = z.object({ id: z.string().uuid() });

export const employeeRoutes = new Hono<OperatorEnv>()
  .get("/", validate("query", employeeListQuerySchema), async (c) =>
    c.json(await listEmployees(c.req.valid("query")), 200),
  )
  .post("/", validate("json", employeeCreateSchema), async (c) =>
    c.json(await createEmployee(c.req.valid("json"), c.var.auth.userId), 201),
  )
  .get("/:id", validate("param", idParam), async (c) => c.json(await getEmployeeDetail(c.req.valid("param").id), 200))
  .patch("/:id", validate("param", idParam), validate("json", employeeUpdateSchema), async (c) =>
    c.json(await updateEmployee(c.req.valid("param").id, c.req.valid("json"), c.var.auth.userId), 200),
  )
  .post("/:id/archive", validate("param", idParam), async (c) =>
    c.json(await archiveEmployee(c.req.valid("param").id, c.var.auth.userId), 200),
  )
  .post("/:id/restore", validate("param", idParam), async (c) =>
    c.json(await restoreEmployee(c.req.valid("param").id, c.var.auth.userId), 200),
  )
  .post("/:id/adjustments", validate("param", idParam), validate("json", adjustmentSchema), async (c) =>
    c.json(await addAdjustment(c.req.valid("param").id, c.req.valid("json"), c.var.auth.userId), 201),
  );
