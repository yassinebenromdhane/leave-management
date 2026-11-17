// /api/operator/settings, /settings/company, /departments/:id, /leave-types[/:id[/policy]]
// (spec 1.5). Operator only (routes/operator/index.ts).
import {
  companySettingsUpdateSchema,
  departmentUpdateSchema,
  leavePolicyInputSchema,
  leaveTypeCreateSchema,
  leaveTypeUpdateSchema,
  yearQuerySchema,
} from "@leave/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { OperatorEnv } from "../../auth/middleware";
import {
  createLeaveType,
  deleteDepartment,
  getSettings,
  setPolicy,
  updateCompany,
  updateDepartment,
  updateLeaveType,
} from "../../domain/settingsService";
import { validate } from "../validate";

const idParam = z.object({ id: z.string().uuid() });

export const settingsRoutes = new Hono<OperatorEnv>()
  .get("/settings", validate("query", yearQuerySchema), async (c) =>
    c.json(await getSettings(c.req.valid("query").year), 200),
  )
  .patch("/settings/company", validate("json", companySettingsUpdateSchema), async (c) =>
    c.json(await updateCompany(c.req.valid("json"), c.var.auth.userId), 200),
  )
  .patch("/departments/:id", validate("param", idParam), validate("json", departmentUpdateSchema), async (c) =>
    c.json(await updateDepartment(c.req.valid("param").id, c.req.valid("json"), c.var.auth.userId), 200),
  )
  .delete("/departments/:id", validate("param", idParam), async (c) =>
    c.json(await deleteDepartment(c.req.valid("param").id, c.var.auth.userId), 200),
  )
  .post("/leave-types", validate("json", leaveTypeCreateSchema), async (c) =>
    c.json(await createLeaveType(c.req.valid("json"), c.var.auth.userId), 201),
  )
  .patch("/leave-types/:id", validate("param", idParam), validate("json", leaveTypeUpdateSchema), async (c) =>
    c.json(await updateLeaveType(c.req.valid("param").id, c.req.valid("json"), c.var.auth.userId), 200),
  )
  .post("/leave-types/:id/policy", validate("param", idParam), validate("json", leavePolicyInputSchema), async (c) =>
    c.json(await setPolicy(c.req.valid("param").id, c.req.valid("json"), c.var.auth.userId), 201),
  );
