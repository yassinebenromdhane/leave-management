import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/common/api/keys";

/** After any portal mutation the server's numbers are refetched; balances are never patched here. */
export const refreshPortal = (qc: QueryClient): Promise<unknown> =>
  Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.portalDashboard }),
    qc.invalidateQueries({ queryKey: queryKeys.portalLeaves }),
    qc.invalidateQueries({ queryKey: queryKeys.portalLedger() }),
  ]);
