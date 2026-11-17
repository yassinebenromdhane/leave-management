// One place that fetches and derives everything the workspace shows:
//   leaves  = one GET /leaves over the union range (period + this/next week + 14 days) merged with
//             the pending list (so the Pending KPI counts every undecided request, whatever the date)
//   scoped  = department / type / search applied (also what the KPI numbers are computed from)
//   visible = scoped + status filter + KPI filter (what the timeline, agenda and list show)
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useEmployees } from "@/common/api/employees";
import { useLeaves } from "@/common/api/leaves";
import { useReference } from "@/common/api/reference";
import { useOperatorUi } from "../OperatorContext";
import { buildGroups, fetchRange } from "./agendaModel";
import { matchesStatus, mergeLeaves, scopeEmployees, scopeLeaves } from "./filters";
import { computeKpis, leaveMatchesKpi, lowBalanceEmployees, type CalendarContext } from "./kpis";
import { barGeometry, buildColumns } from "./timelineModel";

export function useWorkspaceData() {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  const { filters, period, today } = useOperatorUi();

  const range = useMemo(() => fetchRange(period, today), [period, today]);
  const periodLeaves = useLeaves(range);
  const pendingLeaves = useLeaves({ status: "pending" });
  const employeesQ = useEmployees("active");
  const reference = useReference();

  const ctx = useMemo<CalendarContext>(
    () => ({ today, workDays: reference.data?.workDays ?? 31, holidays: reference.data?.holidays ?? [] }),
    [today, reference.data],
  );

  const derived = useMemo(() => {
    const all = mergeLeaves(periodLeaves.data, pendingLeaves.data);
    const employees = employeesQ.data ?? [];
    const scoped = scopeLeaves(all, filters, locale);
    const scopedEmployees = scopeEmployees(employees, filters, locale);
    const kpis = computeKpis({ leaves: scoped, employees: scopedEmployees, leaveTypeId: filters.leaveTypeId, ctx });
    const lowIds = new Set(lowBalanceEmployees(scopedEmployees, filters.leaveTypeId).map((x) => x.employee.id));
    const visible = scoped.filter(
      (l) => matchesStatus(l.status, filters.status) && (!filters.kpi || leaveMatchesKpi(l, filters.kpi, today, lowIds)),
    );
    // Bars in the visible period; with a KPI filter on, the list shows every match regardless of period.
    const inPeriod = visible.filter((l) => barGeometry(l, period.from, period.to) !== null);
    return { all, scoped, scopedEmployees, kpis, lowIds, visible, inPeriod };
  }, [periodLeaves.data, pendingLeaves.data, employeesQ.data, filters, locale, ctx, today, period]);

  const columns = useMemo(
    () => buildColumns(period.from, period.to, ctx.workDays, ctx.holidays, today),
    [period, ctx.workDays, ctx.holidays, today],
  );

  const groups = useMemo(
    () =>
      buildGroups(derived.scopedEmployees, derived.inPeriod, reference.data?.departments ?? [], {
        requireLeaves: filters.kpi !== null && filters.kpi !== "low",
        keepIds: filters.kpi === "low" ? derived.lowIds : undefined,
      }),
    [derived, reference.data?.departments, filters.kpi],
  );

  return {
    ...derived,
    ctx,
    columns,
    groups,
    employees: employeesQ.data ?? [],
    reference: reference.data,
    loading: periodLeaves.isPending || employeesQ.isPending || reference.isPending,
    error: periodLeaves.error ?? employeesQ.error ?? reference.error ?? null,
    refetch: () => {
      void periodLeaves.refetch();
      void employeesQ.refetch();
      void reference.refetch();
    },
  };
}
