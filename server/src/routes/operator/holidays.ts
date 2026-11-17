// /api/operator/holidays (spec 1.5) + the rule-8 recalculation confirm step. Operator only.
import { holidayCreateSchema, holidayRecalculateSchema, holidayUpdateSchema, yearQuerySchema } from "@leave/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { OperatorEnv } from "../../auth/middleware";
import {
  createHoliday,
  deleteHoliday,
  listHolidays,
  recalculateHolidayLeaves,
  updateHoliday,
} from "../../domain/holidayService";
import { todayIso } from "../../domain/today";
import { validate } from "../validate";

const idParam = z.object({ id: z.string().uuid() });

export const holidayRoutes = new Hono<OperatorEnv>()
  .get("/", validate("query", yearQuerySchema), async (c) =>
    c.json(await listHolidays(c.req.valid("query").year ?? Number(todayIso().slice(0, 4))), 200),
  )
  .post("/", validate("json", holidayCreateSchema), async (c) =>
    c.json(await createHoliday(c.req.valid("json"), c.var.auth.userId), 201),
  )
  .post("/recalculate", validate("json", holidayRecalculateSchema), async (c) =>
    c.json(await recalculateHolidayLeaves(c.req.valid("json").leaveIds, c.var.auth.userId), 200),
  )
  .patch("/:id", validate("param", idParam), validate("json", holidayUpdateSchema), async (c) =>
    c.json(await updateHoliday(c.req.valid("param").id, c.req.valid("json"), c.var.auth.userId), 200),
  )
  .delete("/:id", validate("param", idParam), async (c) =>
    c.json(await deleteHoliday(c.req.valid("param").id, c.var.auth.userId), 200),
  );
