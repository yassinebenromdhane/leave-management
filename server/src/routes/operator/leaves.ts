// /api/operator/leaves: list, preview, create, detail, edit, status, bulk approve, soft delete,
// restore (Undo) and attachment upload. Operator only (routes/operator/index.ts).
import {
  ATTACHMENT_MAX_BYTES,
  leaveBulkStatusSchema,
  leaveCreateSchema,
  leaveListQuerySchema,
  leavePreviewSchema,
  leaveStatusChangeSchema,
  leaveUpdateSchema,
} from "@leave/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { OperatorEnv } from "../../auth/middleware";
import { uploadAttachment } from "../../domain/attachmentService";
import {
  bulkChangeStatus,
  changeLeaveStatus,
  createLeave,
  deleteLeave,
  getLeave,
  listLeaves,
  previewLeave,
  restoreLeave,
  updateLeave,
} from "../../domain/leaveService";
import { validate } from "../validate";

const idParam = z.object({ id: z.string().uuid() });
const uploadForm = z.object({ file: z.instanceof(File, { message: "attachments.errors.missing" }) });

// Multipart framing adds a little on top of the file itself; the exact file size is re-checked.
const MULTIPART_OVERHEAD = 64 * 1024;

export const leaveRoutes = new Hono<OperatorEnv>()
  .get("/", validate("query", leaveListQuerySchema), async (c) => c.json(await listLeaves(c.req.valid("query")), 200))
  .post("/preview", validate("json", leavePreviewSchema), async (c) =>
    c.json(await previewLeave(c.req.valid("json")), 200),
  )
  .post("/bulk-status", validate("json", leaveBulkStatusSchema), async (c) =>
    c.json(await bulkChangeStatus(c.req.valid("json"), c.var.auth.userId), 200),
  )
  .post("/", validate("json", leaveCreateSchema), async (c) =>
    c.json(await createLeave(c.req.valid("json"), c.var.auth.userId), 201),
  )
  .get("/:id", validate("param", idParam), async (c) => c.json(await getLeave(c.req.valid("param").id), 200))
  .patch("/:id", validate("param", idParam), validate("json", leaveUpdateSchema), async (c) =>
    c.json(await updateLeave(c.req.valid("param").id, c.req.valid("json"), c.var.auth.userId), 200),
  )
  .post("/:id/status", validate("param", idParam), validate("json", leaveStatusChangeSchema), async (c) =>
    c.json(await changeLeaveStatus(c.req.valid("param").id, c.req.valid("json"), c.var.auth.userId), 200),
  )
  .delete("/:id", validate("param", idParam), async (c) =>
    c.json(await deleteLeave(c.req.valid("param").id, c.var.auth.userId), 200),
  )
  .post("/:id/restore", validate("param", idParam), async (c) =>
    c.json(await restoreLeave(c.req.valid("param").id, c.var.auth.userId), 200),
  )
  .post(
    "/:id/attachments",
    validate("param", idParam),
    bodyLimit({
      maxSize: ATTACHMENT_MAX_BYTES + MULTIPART_OVERHEAD,
      onError: (c) => c.json({ code: "attachments.errors.tooLarge" }, 413),
    }),
    validate("form", uploadForm),
    async (c) =>
      c.json(await uploadAttachment(c.req.valid("param").id, c.req.valid("form").file, c.var.auth.userId), 201),
  );
