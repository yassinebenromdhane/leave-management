import type { LeaveStatus } from "@leave/shared";

/** Status moves the server accepts. approved -> pending is allowed (it backs the Undo of an approval; the server writes a reversal). */
export function allowedTransitions(status: LeaveStatus): LeaveStatus[] {
  switch (status) {
    case "pending":
      return ["approved", "rejected", "cancelled"];
    case "approved":
      return ["pending", "rejected", "cancelled"];
    case "rejected":
    case "cancelled":
      return ["pending", "approved"];
  }
}
