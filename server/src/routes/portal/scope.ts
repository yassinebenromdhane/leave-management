// The ONE way a portal handler learns who it serves: the session (set by requireEmployee).
// Never build a PortalScope from params, query or body (CLAUDE.md invariant 5).
import type { Context } from "hono";
import type { EmployeeEnv } from "../../auth/middleware";
import type { PortalScope } from "../../domain/portalService";

export const portalScope = (c: Context<EmployeeEnv>): PortalScope => ({
  employeeId: c.var.auth.employeeId,
  userId: c.var.auth.userId,
});
