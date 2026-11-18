// Operator employee hooks over /api/operator/employees and /departments.
import type { AdjustmentInput, DepartmentInput, EmployeeCreateInput, EmployeeUpdateInput } from "@leave/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { unwrap } from "./http";
import { invalidateLeaveData } from "./invalidate";
import { queryKeys } from "./keys";

export type EmployeeStatusFilter = "active" | "archived" | "all";

const fetchEmployees = (status: EmployeeStatusFilter) => unwrap(api.api.operator.employees.$get({ query: { status } }));
const fetchEmployee = (id: string) => unwrap(api.api.operator.employees[":id"].$get({ param: { id } }));

export type EmployeeRow = Awaited<ReturnType<typeof fetchEmployees>>[number];
export type EmployeeDetail = Awaited<ReturnType<typeof fetchEmployee>>;
export type BalanceSummary = EmployeeRow["balances"][string];
export type LedgerLine = EmployeeDetail["ledger"][string][number];

export function useEmployees(status: EmployeeStatusFilter) {
  return useQuery({
    queryKey: queryKeys.employees(status),
    queryFn: () => fetchEmployees(status),
    refetchInterval: 30_000, // fallback when the SSE stream (useLeaveEvents) is down
  });
}

export function useEmployeeDetail(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.employee(id ?? ""),
    queryFn: () => fetchEmployee(id as string),
    enabled: Boolean(id),
  });
}

export function useEmployeeMutations() {
  const qc = useQueryClient();
  const settled = () => invalidateLeaveData(qc);
  return {
    create: useMutation({
      mutationFn: (input: EmployeeCreateInput) => unwrap(api.api.operator.employees.$post({ json: input })),
      onSettled: settled,
    }),
    update: useMutation({
      mutationFn: (v: { id: string; patch: EmployeeUpdateInput }) =>
        unwrap(api.api.operator.employees[":id"].$patch({ param: { id: v.id }, json: v.patch })),
      onMutate: async (v) => {
        await qc.cancelQueries({ queryKey: queryKeys.employees() });
        const snapshots = qc.getQueriesData<EmployeeRow[]>({ queryKey: queryKeys.employees() });
        qc.setQueriesData<EmployeeRow[]>({ queryKey: queryKeys.employees() }, (rows) =>
          rows?.map((r) => (r.id === v.id ? ({ ...r, ...v.patch } as EmployeeRow) : r)),
        );
        return { snapshots };
      },
      onError: (_e, _v, ctx) => ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data)),
      onSettled: settled,
    }),
    archive: useMutation({
      mutationFn: (id: string) => unwrap(api.api.operator.employees[":id"].archive.$post({ param: { id } })),
      onSettled: settled,
    }),
    restore: useMutation({
      mutationFn: (id: string) => unwrap(api.api.operator.employees[":id"].restore.$post({ param: { id } })),
      onSettled: settled,
    }),
    adjust: useMutation({
      mutationFn: (v: { id: string; input: AdjustmentInput }) =>
        unwrap(api.api.operator.employees[":id"].adjustments.$post({ param: { id: v.id }, json: v.input })),
      onSettled: settled,
    }),
    createDepartment: useMutation({
      mutationFn: (input: DepartmentInput) => unwrap(api.api.operator.departments.$post({ json: input })),
      onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.reference }),
    }),
    invite: useMutation({
      mutationFn: (id: string) => unwrap(api.api.operator.employees[":employeeId"].invite.$post({ param: { employeeId: id } })),
      onSettled: settled,
    }),
    temporaryPassword: useMutation({
      mutationFn: (id: string) =>
        unwrap(api.api.operator.employees[":employeeId"]["temporary-password"].$post({ param: { employeeId: id } })),
      onSettled: settled,
    }),
    portalAccess: useMutation({
      mutationFn: (v: { id: string; enabled: boolean }) =>
        unwrap(api.api.operator.employees[":employeeId"]["portal-access"].$put({ param: { employeeId: v.id }, json: { enabled: v.enabled } })),
      onSettled: settled,
    }),
    signOutEverywhere: useMutation({
      mutationFn: (id: string) =>
        unwrap(api.api.operator.employees[":employeeId"]["sign-out-everywhere"].$post({ param: { employeeId: id } })),
    }),
  };
}
