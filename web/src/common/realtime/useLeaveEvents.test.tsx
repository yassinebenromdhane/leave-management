import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keysForEvent, useLeaveEvents, type LeaveEventType } from "./useLeaveEvents";

class FakeEventSource {
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = 1;
  closed = false;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Array<(e: { data: string }) => void>>();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.forEach((fn) => fn({ data: JSON.stringify(data) }));
  }
}

function setup(surface: "operator" | "portal", onEvent?: Parameters<typeof useLeaveEvents>[1]) {
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
  const setData = vi.spyOn(qc, "setQueryData");
  const setAll = vi.spyOn(qc, "setQueriesData");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const view = renderHook(() => useLeaveEvents(surface, onEvent), { wrapper });
  const keys = () => invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
  return { view, invalidate, setData, setAll, keys, es: FakeEventSource.instances[FakeEventSource.instances.length - 1]! };
}

describe("useLeaveEvents", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("opens one EventSource on /api/events and closes it on unmount", () => {
    const { view, es } = setup("operator");
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(es.url).toBe("/api/events");
    view.unmount();
    expect(es.closed).toBe(true);
  });

  const operatorKeys = [["employees"], ["employee"], ["leaves"], ["leave"], ["leave-preview"]];
  it.each<LeaveEventType>(["leave.submitted", "leave.withdrawn", "leave.decided", "leave.changed"])(
    "operator: %s refetches KPIs, leaves and employees",
    async (type) => {
      const { keys, es } = setup("operator");
      es.emit(type, { type, leaveRequestId: "l1", employeeId: "e1" });
      expect(keys()).toEqual(operatorKeys);
    },
  );

  it("portal: submitted / withdrawn refetch dashboard and leaves only", () => {
    const { keys, es } = setup("portal");
    es.emit("leave.withdrawn", { type: "leave.withdrawn", leaveRequestId: "l1", employeeId: "e1" });
    expect(keys()).toEqual([["portal", "dashboard"], ["portal", "leaves"]]);
  });

  it("portal: decided / changed also refetch the ledger and preview", () => {
    const { keys, es } = setup("portal");
    es.emit("leave.decided", { type: "leave.decided", leaveRequestId: "l1", employeeId: "e1" });
    expect(keys()).toEqual([["portal", "dashboard"], ["portal", "leaves"], ["portal", "ledger"], ["portal", "preview"]]);
    expect(keysForEvent("portal", "leave.changed")).toEqual(keysForEvent("portal", "leave.decided"));
  });

  it("never writes event data into the cache", () => {
    const { setData, setAll, es } = setup("portal");
    for (const type of ["leave.submitted", "leave.withdrawn", "leave.decided", "leave.changed"] as const) {
      es.emit(type, { type, leaveRequestId: "l1", employeeId: "e1" });
    }
    expect(setData).not.toHaveBeenCalled();
    expect(setAll).not.toHaveBeenCalled();
  });

  it("hands the ids to the callback after the invalidation", async () => {
    const onEvent = vi.fn();
    const { es } = setup("operator", onEvent);
    es.emit("leave.submitted", { type: "leave.submitted", leaveRequestId: "l9", employeeId: "e2" });
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith({ type: "leave.submitted", leaveRequestId: "l9", employeeId: "e2" }));
  });
});
