import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./keys";

/**
 * After any leave / ledger / employee mutation (or SSE event) the server's numbers are refetched.
 * Balances are never patched on the client (CLAUDE.md invariant 1).
 */
export function invalidateLeaveData(qc: QueryClient): Promise<unknown> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.employees() }),
    qc.invalidateQueries({ queryKey: ["employee"] }),
    qc.invalidateQueries({ queryKey: queryKeys.leaves() }),
    qc.invalidateQueries({ queryKey: ["leave"] }),
    qc.invalidateQueries({ queryKey: ["leave-preview"] }),
  ]);
}
