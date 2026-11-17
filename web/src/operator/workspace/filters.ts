// Workspace filters (spec 2.1): department, type, status, search and the KPI toggle. Persisted per
// session; they also scope the KPI numbers. Pure helpers, no React.
import type { LeaveStatus } from "@leave/shared";
import type { EmployeeRow } from "@/common/api/employees";
import type { LeaveRow } from "@/common/api/leaves";
import { readStorage, writeStorage } from "@/common/lib/storage";

export type KpiKey = "out" | "pending" | "upcoming" | "low";
export const KPI_KEYS: readonly KpiKey[] = ["out", "pending", "upcoming", "low"];

/** "default" hides rejected and cancelled leaves (spec 1.4); "all" shows every status. */
export type StatusFilter = "default" | "all" | LeaveStatus;
export const STATUS_FILTERS: readonly StatusFilter[] = ["default", "pending", "approved", "rejected", "cancelled", "all"];

export type Filters = {
  departmentId: string | null;
  leaveTypeId: string | null;
  status: StatusFilter;
  kpi: KpiKey | null;
  search: string;
};

export const EMPTY_FILTERS: Filters = { departmentId: null, leaveTypeId: null, status: "default", kpi: null, search: "" };

const STORAGE_KEY = "leave.workspaceFilters";

export function loadFilters(): Filters {
  const raw = readStorage(STORAGE_KEY, true);
  if (!raw) return EMPTY_FILTERS;
  try {
    const v = JSON.parse(raw) as Partial<Filters>;
    return {
      departmentId: typeof v.departmentId === "string" ? v.departmentId : null,
      leaveTypeId: typeof v.leaveTypeId === "string" ? v.leaveTypeId : null,
      status: STATUS_FILTERS.includes(v.status as StatusFilter) ? (v.status as StatusFilter) : "default",
      kpi: KPI_KEYS.includes(v.kpi as KpiKey) ? (v.kpi as KpiKey) : null,
      search: typeof v.search === "string" ? v.search : "",
    };
  } catch {
    return EMPTY_FILTERS;
  }
}

export function saveFilters(f: Filters): void {
  writeStorage(STORAGE_KEY, JSON.stringify(f), true);
}

/** Clicking a KPI card selects it; clicking the selected one clears it. */
export const toggleKpi = (f: Filters, key: KpiKey): Filters => ({ ...f, kpi: f.kpi === key ? null : key });

export const hasActiveFilters = (f: Filters): boolean =>
  f.departmentId !== null || f.leaveTypeId !== null || f.status !== "default" || f.kpi !== null || f.search.trim() !== "";

const matchesName = (name: string, search: string, locale: string): boolean => {
  const q = search.trim().toLocaleLowerCase(locale);
  return !q || name.toLocaleLowerCase(locale).includes(q);
};

/** Department, type and search: the scope shared by the workspace and the KPI numbers. */
export function scopeLeaves(leaves: readonly LeaveRow[], f: Filters, locale: string): LeaveRow[] {
  return leaves.filter(
    (l) =>
      (!f.departmentId || l.departmentId === f.departmentId || l.departmentId === "") &&
      (!f.leaveTypeId || l.leaveTypeId === f.leaveTypeId) &&
      matchesName(l.employeeName, f.search, locale),
  );
}

export function scopeEmployees(employees: readonly EmployeeRow[], f: Filters, locale: string): EmployeeRow[] {
  return employees.filter((e) => (!f.departmentId || e.departmentId === f.departmentId) && matchesName(e.fullName, f.search, locale));
}

export function matchesStatus(status: LeaveStatus, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "default") return status === "pending" || status === "approved";
  return status === filter;
}

/** Keeps one row per id; earlier arrays win. Used to merge the period query and the pending query. */
export function mergeLeaves(...lists: ReadonlyArray<readonly LeaveRow[] | undefined>): LeaveRow[] {
  const seen = new Map<string, LeaveRow>();
  for (const list of lists) for (const l of list ?? []) if (!seen.has(l.id)) seen.set(l.id, l);
  return [...seen.values()];
}
