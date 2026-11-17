// /api/me/*: employee portal (spec 1.7, 4.3). Every handler builds its scope with portalScope(c),
// which reads the SESSION's employeeId. Ids in the URL are only ever ids of the employee's own
// rows, and the domain query filters them by the session employee (someone else's id → 404).
import {
  ATTACHMENT_MAX_BYTES,
  portalLeaveSubmitSchema,
  portalPreviewSchema,
  portalReferenceQuerySchema,
  portalTeamQuerySchema,
} from "@leave/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { requireEmployee, type EmployeeEnv } from "../../auth/middleware";
import { rateLimit } from "../../auth/rateLimit";
import { db } from "../../db/client";
import { department, employee } from "../../db/schema";
import {
  deleteOwnAttachment,
  getDashboard,
  getOwnLedger,
  getPortalReference,
  getTeam,
  listOwnAttachments,
  listOwnLeaves,
  markNotificationRead,
  previewOwnLeave,
  submitLeave,
  withdrawLeave,
} from "../../domain/portalService";
import { validate } from "../validate";
import { portalScope } from "./scope";

const idParam = z.object({ id: z.string().uuid() });
const typeParam = z.object({ leaveTypeId: z.string().uuid() });

/** Multipart submit: `data` = JSON of portalLeaveSubmitSchema, `file` = optional attachment. */
const submitForm = z.object({
  data: z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "errors.validation" });
        return z.NEVER;
      }
    })
    .pipe(portalLeaveSubmitSchema),
  file: z.instanceof(File).optional(),
});

// Multipart framing adds a little on top of the file; the exact file size is re-checked.
const MULTIPART_OVERHEAD = 64 * 1024;

export const portalRoutes = new Hono<EmployeeEnv>()
  .use(requireEmployee)
  // Own employee row: name, department, hire date only (spec 4.3 access matrix).
  .get("/profile", async (c) => {
    const [row] = await db
      .select({ fullName: employee.fullName, department: department.name, hireDate: employee.hireDate })
      .from(employee)
      .innerJoin(department, eq(department.id, employee.departmentId))
      .where(eq(employee.id, portalScope(c).employeeId))
      .limit(1);
    if (!row) return c.json({ code: "errors.notFound" }, 404);
    return c.json(row, 200);
  })
  .get("/reference", validate("query", portalReferenceQuerySchema), async (c) =>
    c.json(await getPortalReference(portalScope(c), c.req.valid("query")), 200),
  )
  .get("/dashboard", async (c) => c.json(await getDashboard(portalScope(c)), 200))
  .get("/leaves", async (c) => c.json(await listOwnLeaves(portalScope(c)), 200))
  .get("/ledger/:leaveTypeId", validate("param", typeParam), async (c) =>
    c.json(await getOwnLedger(portalScope(c), c.req.valid("param").leaveTypeId), 200),
  )
  .get("/team", validate("query", portalTeamQuerySchema), async (c) =>
    c.json(await getTeam(portalScope(c), c.req.valid("query")), 200),
  )
  // Debounced by the UI; the cap only stops scripted floods (security audit, step 5).
  .use("/leaves/preview", rateLimit({ name: "portal-preview", max: 120, windowMs: 60_000 }))
  .post("/leaves/preview", validate("json", portalPreviewSchema), async (c) =>
    c.json(await previewOwnLeave(portalScope(c), c.req.valid("json")), 200),
  )
  .post(
    "/leaves",
    bodyLimit({
      maxSize: ATTACHMENT_MAX_BYTES + MULTIPART_OVERHEAD,
      onError: (c) => c.json({ code: "attachments.errors.tooLarge" }, 413),
    }),
    validate("form", submitForm),
    async (c) => {
      const form = c.req.valid("form");
      return c.json(await submitLeave(portalScope(c), form.data, form.file), 201);
    },
  )
  .post("/leaves/:id/withdraw", validate("param", idParam), async (c) =>
    c.json(await withdrawLeave(portalScope(c), c.req.valid("param").id), 200),
  )
  .get("/leaves/:id/attachments", validate("param", idParam), async (c) =>
    c.json(await listOwnAttachments(portalScope(c), c.req.valid("param").id), 200),
  )
  .delete("/attachments/:id", validate("param", idParam), async (c) =>
    c.json(await deleteOwnAttachment(portalScope(c), c.req.valid("param").id), 200),
  )
  .post("/notifications/:id/read", validate("param", idParam), async (c) =>
    c.json(await markNotificationRead(portalScope(c), c.req.valid("param").id), 200),
  );
