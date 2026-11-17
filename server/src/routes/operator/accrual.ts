// /api/operator/accrual: MVP manual "Run accrual" (spec 3.1, rule 6). Operator only.
import { accrualPeriodSchema } from "@leave/shared";
import { Hono } from "hono";
import type { OperatorEnv } from "../../auth/middleware";
import { previewAccrual, runAccrual } from "../../domain/accrualService";
import { validate } from "../validate";

export const accrualRoutes = new Hono<OperatorEnv>()
  .post("/preview", validate("json", accrualPeriodSchema), async (c) =>
    c.json(await previewAccrual(c.req.valid("json").period), 200),
  )
  .post("/run", validate("json", accrualPeriodSchema), async (c) =>
    c.json(await runAccrual(c.req.valid("json").period, c.var.auth.userId), 200),
  );
