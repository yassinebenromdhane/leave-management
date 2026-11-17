// Operator settings hooks and raw calls: company, departments, leave types, policies, holidays,
// accrual. Every successful write invalidates reference / employees / leaves (balances are server-computed).
import type {
  CompanySettingsUpdateInput,
  DepartmentUpdateInput,
  HolidayCreateInput,
  HolidayUpdateInput,
  LeavePolicyInput,
  LeaveTypeCreateInput,
  LeaveTypeUpdateInput,
} from "@leave/shared";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { unwrap } from "./http";
import { invalidateLeaveData } from "./invalidate";
import { queryKeys } from "./keys";

const op = api.api.operator;
const fetchSettings = (year?: number) => unwrap(op.settings.$get({ query: year ? { year: String(year) } : {} }));

export type SettingsData = Awaited<ReturnType<typeof fetchSettings>>;
export type CompanySettings = SettingsData["company"];
export type DepartmentRow = SettingsData["departments"][number];
export type SettingsLeaveType = SettingsData["leaveTypes"][number];
export type PolicyGroup = SettingsData["policies"][number];

export type HolidayRow = Awaited<ReturnType<typeof fetchHolidays>>[number];

const createHoliday = (input: HolidayCreateInput) => unwrap(op.holidays.$post({ json: input }));
export type HolidayWrite = Awaited<ReturnType<typeof createHoliday>>;
export type AffectedLeave = HolidayWrite["affectedLeaves"][number];

const previewAccrual = (period: string) => unwrap(op.accrual.preview.$post({ json: { period } }));
export type AccrualPreview = Awaited<ReturnType<typeof previewAccrual>>;

const fetchHolidays = (year: number) => unwrap(op.holidays.$get({ query: { year: String(year) } }));

export function useHolidays(year: number) {
  return useQuery({ queryKey: queryKeys.holidays(year), queryFn: () => fetchHolidays(year) });
}

export function useSettings(year?: number) {
  return useQuery({ queryKey: queryKeys.settings(year), queryFn: () => fetchSettings(year) });
}

/** Settings, reference data, balances and leaves all depend on these rules: refetch them all. */
export function invalidateSettings(qc: QueryClient): Promise<unknown> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.settings() }),
    qc.invalidateQueries({ queryKey: queryKeys.reference }),
    qc.invalidateQueries({ queryKey: ["report"] }),
    qc.invalidateQueries({ queryKey: ["holidays"] }),
    invalidateLeaveData(qc),
  ]);
}

/** Wraps a write so the dependent caches are refetched afterwards, success or not. */
export function useSettingsWrite() {
  const qc = useQueryClient();
  return async <T,>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } finally {
      void invalidateSettings(qc);
    }
  };
}

export const settingsApi = {
  updateCompany: (input: CompanySettingsUpdateInput) => unwrap(op.settings.company.$patch({ json: input })),
  createDepartment: (name: string) => unwrap(op.departments.$post({ json: { name } })),
  updateDepartment: (id: string, input: DepartmentUpdateInput) => unwrap(op.departments[":id"].$patch({ param: { id }, json: input })),
  deleteDepartment: (id: string) => unwrap(op.departments[":id"].$delete({ param: { id } })),
  createLeaveType: (input: LeaveTypeCreateInput) => unwrap(op["leave-types"].$post({ json: input })),
  updateLeaveType: (id: string, input: LeaveTypeUpdateInput) => unwrap(op["leave-types"][":id"].$patch({ param: { id }, json: input })),
  setPolicy: (id: string, input: LeavePolicyInput) => unwrap(op["leave-types"][":id"].policy.$post({ param: { id }, json: input })),
  createHoliday,
  updateHoliday: (id: string, input: HolidayUpdateInput) => unwrap(op.holidays[":id"].$patch({ param: { id }, json: input })),
  deleteHoliday: (id: string) => unwrap(op.holidays[":id"].$delete({ param: { id } })),
  recalculate: (leaveIds: string[]) => unwrap(op.holidays.recalculate.$post({ json: { leaveIds } })),
  previewAccrual,
  runAccrual: (period: string) => unwrap(op.accrual.run.$post({ json: { period } })),
};
