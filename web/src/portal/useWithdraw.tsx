// Withdraw flow shared by Home and My leaves: no confirmation dialog. The request is withdrawn at
// once and the toast offers Undo for 6 s (spec 2.3: confirmations only for destructive actions).
import type { PortalLeaveItem } from "@/common/api/portal";
import { usePortalActions } from "./usePortalActions";

export function useWithdraw(): (leave: PortalLeaveItem) => void {
  const actions = usePortalActions();
  return (leave) => void actions.withdraw(leave.id);
}
