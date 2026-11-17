// /api/files/:attachmentId: the only way to download an attachment (never served statically).
// Access: the operator, or the employee who owns the leave; anything else is a 404.
import { AUTH_ERRORS } from "@leave/shared";
import { Hono } from "hono";
import { z } from "zod";
import { loadAuthUser } from "../auth/middleware";
import { openAttachment } from "../domain/attachmentService";
import { validate } from "./validate";

/** RFC 5987 encoding for filename*=UTF-8''… */
const encodeRfc5987 = (s: string) =>
  encodeURIComponent(s).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

export const fileRoutes = new Hono().get(
  "/:attachmentId",
  validate("param", z.object({ attachmentId: z.string().uuid() })),
  async (c) => {
    const who = await loadAuthUser(c);
    if (!who) return c.json({ code: AUTH_ERRORS.unauthenticated }, 401);
    if (who.mustChangePassword) return c.json({ code: AUTH_ERRORS.mustChangePassword }, 403);
    const file = await openAttachment(c.req.valid("param").attachmentId, who);
    const ascii = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    return c.body(file.stream, 200, {
      "content-type": file.mimeType,
      "content-length": String(file.sizeBytes),
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(file.fileName)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    });
  },
);
