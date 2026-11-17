// /api/operator/attachments/:id: soft delete (operator only; routes/operator/index.ts).
import { Hono } from "hono";
import { z } from "zod";
import type { OperatorEnv } from "../../auth/middleware";
import { deleteAttachment } from "../../domain/attachmentService";
import { validate } from "../validate";

export const attachmentRoutes = new Hono<OperatorEnv>().delete(
  "/:id",
  validate("param", z.object({ id: z.string().uuid() })),
  async (c) => c.json(await deleteAttachment(c.req.valid("param").id, c.var.auth.userId), 200),
);
