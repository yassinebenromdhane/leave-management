// Live sync (spec 4.3, CLAUDE.md invariant 11): events are SIGNALS. One EventSource per tab; every
// event only invalidates TanStack Query keys, so the numbers come back from the server. Event data
// is never written into the cache. The browser reconnects by itself; the 30 s refetchInterval on
// the affected queries is the fallback when the stream is down.
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { queryKeys } from "@/common/api/keys";

export const LEAVE_EVENT_TYPES = ["leave.submitted", "leave.withdrawn", "leave.decided", "leave.changed"] as const;
export type LeaveEventType = (typeof LEAVE_EVENT_TYPES)[number];
export type LeaveEvent = { type: LeaveEventType; leaveRequestId: string; employeeId: string };
export type Surface = "operator" | "portal";

/** Query keys to refetch for an event, per surface. */
export function keysForEvent(surface: Surface, type: LeaveEventType): QueryKey[] {
  if (surface === "operator") {
    // KPIs, timeline bars, pending list and balances all derive from these.
    return [queryKeys.employees(), ["employee"], queryKeys.leaves(), ["leave"], ["leave-preview"]];
  }
  const own: QueryKey[] = [queryKeys.portalDashboard, queryKeys.portalLeaves];
  // A decision or an HR change moves the ledger, so balances and the ledger sheet refetch too.
  return type === "leave.decided" || type === "leave.changed"
    ? [...own, queryKeys.portalLedger(), [...queryKeys.portal, "preview"]]
    : own;
}

const RECONNECT_MS = 10_000;

export function useLeaveEvents(surface: Surface, onEvent?: (event: LeaveEvent) => void): void {
  const qc = useQueryClient();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (typeof EventSource === "undefined") return; // polling fallback only
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const handle = (type: LeaveEventType) => (msg: MessageEvent) => {
      let event: LeaveEvent = { type, leaveRequestId: "", employeeId: "" };
      try {
        const body = JSON.parse(String(msg.data)) as Partial<LeaveEvent>;
        event = { type, leaveRequestId: body.leaveRequestId ?? "", employeeId: body.employeeId ?? "" };
      } catch {
        // malformed payload: the signal alone is enough to refetch
      }
      const done = Promise.all(keysForEvent(surface, type).map((queryKey) => qc.invalidateQueries({ queryKey })));
      void done.then(() => onEventRef.current?.(event));
    };

    const open = () => {
      source = new EventSource("/api/events");
      for (const type of LEAVE_EVENT_TYPES) source.addEventListener(type, handle(type) as EventListener);
      // A non-200 answer (expired session) closes the stream for good: retry later, polling covers the gap.
      source.onerror = () => {
        if (stopped || source?.readyState !== EventSource.CLOSED) return;
        source.close();
        retry = setTimeout(open, RECONNECT_MS);
      };
    };
    open();

    return () => {
      stopped = true;
      clearTimeout(retry);
      source?.close();
    };
  }, [qc, surface]);
}
