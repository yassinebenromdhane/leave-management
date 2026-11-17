// Notifications (spec 4.3 sync rules 1, 3-5).
// - In-app rows are written INSIDE the business transaction (they are part of the change).
// - Decision emails go out AFTER commit, in the background; the outcome is recorded as a second
//   notification row (channel 'email', sent_at or error). Email failure never rolls back anything.
import type { NotificationKind } from "@leave/shared";
import { eq } from "drizzle-orm";
import { codeOnlyEmail } from "../auth/accounts";
import { companyMailContext } from "../auth/mailContext";
import { db, type Tx } from "../db/client";
import { employee, leaveRequest, leaveType, notification } from "../db/schema";
import { env } from "../env";
import { runInBackground } from "../services/backgroundJobs";
import { sendMail } from "../services/email";
import { decisionEmail } from "../services/emailTemplates";

const CODE_ONLY_DOMAIN = codeOnlyEmail("x").slice(1); // "@employee-code.invalid"

export async function notifyOperator(tx: Tx, leaveRequestId: string, kind: NotificationKind): Promise<void> {
  await tx.insert(notification).values({ recipient: "operator", leaveRequestId, kind, channel: "in_app" });
}

export async function notifyEmployee(
  tx: Tx,
  leave: { id: string; employeeId: string },
  kind: NotificationKind,
): Promise<void> {
  await tx.insert(notification).values({
    recipient: "employee",
    recipientEmployeeId: leave.employeeId,
    leaveRequestId: leave.id,
    kind,
    channel: "in_app",
  });
}

/** A real mailbox: set, and not the placeholder used for code-only logins. */
const isRealEmail = (email: string | null): email is string =>
  !!email && !email.toLowerCase().endsWith(CODE_ONLY_DOMAIN);

/**
 * Sends the approved/rejected email for a leave and records the attempt. Skipped (nothing
 * recorded) when the employee has no live portal access or no real email address.
 */
export async function sendDecisionEmail(leaveRequestId: string): Promise<void> {
  const [row] = await db
    .select({
      employeeId: leaveRequest.employeeId,
      status: leaveRequest.status,
      startDate: leaveRequest.startDate,
      endDate: leaveRequest.endDate,
      startHalf: leaveRequest.startHalf,
      endHalf: leaveRequest.endHalf,
      rejectReason: leaveRequest.rejectReason,
      leaveTypeName: leaveType.name,
      name: employee.fullName,
      email: employee.email,
      portalAccess: employee.portalAccess,
      employeeStatus: employee.status,
    })
    .from(leaveRequest)
    .innerJoin(employee, eq(employee.id, leaveRequest.employeeId))
    .innerJoin(leaveType, eq(leaveType.id, leaveRequest.leaveTypeId))
    .where(eq(leaveRequest.id, leaveRequestId));
  if (!row || (row.status !== "approved" && row.status !== "rejected")) return;
  if (!row.portalAccess || row.employeeStatus !== "active" || !isRealEmail(row.email)) return;

  const { lang } = await companyMailContext();
  const message = decisionEmail(lang, {
    to: row.email,
    name: row.name,
    status: row.status,
    leaveTypeName: row.leaveTypeName,
    startDate: row.startDate,
    endDate: row.endDate,
    startHalf: row.startHalf,
    endHalf: row.endHalf,
    rejectReason: row.rejectReason,
    url: `${env.APP_URL}/me`,
  });

  let error: string | null = null;
  try {
    await sendMail(message);
  } catch (err) {
    error = ((err as Error)?.message ?? String(err)).split("\n")[0]!.slice(0, 500);
    console.error(`[email] decision email for leave ${leaveRequestId} failed: ${error}`);
  }
  await db.insert(notification).values({
    recipient: "employee",
    recipientEmployeeId: row.employeeId,
    leaveRequestId,
    kind: row.status,
    channel: "email",
    sentAt: error ? null : new Date(),
    error,
  });
}

/** Call after commit: queues the decision email without delaying the HTTP response. */
export function queueDecisionEmail(leaveRequestId: string): void {
  runInBackground(`decision email ${leaveRequestId}`, () => sendDecisionEmail(leaveRequestId));
}
