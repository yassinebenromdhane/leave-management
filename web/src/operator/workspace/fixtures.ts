// Test fixtures for the workspace helpers (not imported by production code).
import type { EmployeeRow } from "@/common/api/employees";
import type { LeaveRow } from "@/common/api/leaves";

export const TODAY = "2026-11-16"; // a Monday

let n = 0;
export function leave(over: Partial<LeaveRow> = {}): LeaveRow {
  n += 1;
  return {
    id: `leave-${n}`,
    employeeId: "e1",
    employeeName: "Ines Martin",
    departmentId: "d1",
    departmentName: "Sales",
    leaveTypeId: "t1",
    leaveTypeName: "Paid leave",
    color: "blue",
    startDate: TODAY,
    endDate: TODAY,
    startHalf: "full",
    endHalf: "full",
    workingDays: 1,
    status: "approved",
    note: null,
    rejectReason: null,
    hasWarning: false,
    source: "operator",
    hrChangedAt: null,
    submittedAt: null,
    decidedAt: null,
    createdAt: "2026-11-10T09:00:00.000Z",
    attachmentCount: 0,
    ...over,
  } as LeaveRow;
}

export function employee(over: Partial<EmployeeRow> & { available?: number } = {}): EmployeeRow {
  const { available = 10, ...rest } = over;
  return {
    id: "e1",
    fullName: "Ines Martin",
    departmentId: "d1",
    departmentName: "Sales",
    status: "active",
    balances: { t1: { balance: available, taken: 0, pending: 0, available } },
    ...rest,
  } as unknown as EmployeeRow;
}
