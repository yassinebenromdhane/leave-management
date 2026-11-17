// Shared fixtures and a render helper for the portal tests.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import type { PortalDashboard, PortalLeaveItem, PortalReference } from "@/common/api/portal";
import { ToastProvider } from "@/common/toast/ToastProvider";

export const PAID = { id: "00000000-0000-4000-8000-000000000001", code: "paid", name: "Paid leave", color: "blue", deductsBalance: true, dayCountMode: "working", requiresAttachment: false } as const;
export const SICK = { id: "00000000-0000-4000-8000-000000000002", code: "sick", name: "Sick leave", color: "red", deductsBalance: false, dayCountMode: "calendar", requiresAttachment: true } as const;
export const TRAINING = { id: "00000000-0000-4000-8000-000000000003", code: "training", name: "Training", color: "green", deductsBalance: false, dayCountMode: "working", requiresAttachment: true } as const;

export const reference = {
  workDays: 31, // Monday to Friday
  leaveTypes: [PAID, SICK, TRAINING],
  holidays: [],
  settings: { allowNegative: true, negativeLimitDays: 5 },
} as unknown as PortalReference;

export function leaveRow(over: Partial<PortalLeaveItem> = {}): PortalLeaveItem {
  return {
    id: "l1",
    leaveTypeId: PAID.id,
    leaveTypeName: "Paid leave",
    color: "blue",
    startDate: "2026-12-07",
    endDate: "2026-12-09",
    startHalf: "full",
    endHalf: "full",
    workingDays: 3,
    status: "pending",
    rejectReason: null,
    note: null,
    source: "portal",
    addedByHr: false,
    changedByHr: false,
    submittedAt: null,
    decidedAt: null,
    attachmentCount: 0,
    ...over,
  };
}

export function dashboard(over: Partial<PortalDashboard> = {}): PortalDashboard {
  return {
    me: { fullName: "Ines Martin", department: "Logistics", hireDate: "2024-01-01" },
    balances: [{ leaveTypeId: PAID.id, name: "Paid leave", color: "blue", balance: 18, taken: 8, pending: 2, available: 10 }],
    pending: [],
    upcoming: [],
    decision: null,
    nextHolidays: [],
    ...over,
  } as PortalDashboard;
}

export function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
}

export function renderPortal(ui: ReactElement, qc: QueryClient = makeClient(), route = "/me") {
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[route]}>
          <ToastProvider>{ui}</ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}
