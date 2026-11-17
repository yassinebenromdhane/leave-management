// /api/operator/reports (spec 1.6): JSON preview + XLSX / CSV download. Operator only.
// Files are generated per request and never cached.
import { reportExportQuerySchema, reportPeriodQuerySchema } from "@leave/shared";
import { Hono } from "hono";
import type { OperatorEnv } from "../../auth/middleware";
import { exportReport, leaveDetailReport, payrollReport } from "../../domain/reportService";
import { validate } from "../validate";

const download = (file: Awaited<ReturnType<typeof exportReport>>) => ({
  "Content-Type": file.contentType,
  "Content-Disposition": `attachment; filename="${file.fileName}"`,
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
});

export const reportRoutes = new Hono<OperatorEnv>()
  .get("/payroll", validate("query", reportPeriodQuerySchema), async (c) =>
    c.json(await payrollReport(c.req.valid("query")), 200),
  )
  .get("/leave-detail", validate("query", reportPeriodQuerySchema), async (c) =>
    c.json(await leaveDetailReport(c.req.valid("query")), 200),
  )
  .get("/payroll/export", validate("query", reportExportQuerySchema), async (c) => {
    const { format, ...period } = c.req.valid("query");
    const file = await exportReport("payroll", period, format);
    return c.body(file.body, 200, download(file));
  })
  .get("/leave-detail/export", validate("query", reportExportQuerySchema), async (c) => {
    const { format, ...period } = c.req.valid("query");
    const file = await exportReport("leaveDetail", period, format);
    return c.body(file.body, 200, download(file));
  });
