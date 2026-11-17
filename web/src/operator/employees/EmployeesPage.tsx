// Employees (spec 1.1): dense table, 36 px rows, balances per deducting type, inline edit, quick add.
import { isHalfStep, type EmployeeUpdateInput } from "@leave/shared";
import { Archive, ArchiveRestore } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { useEmployeeMutations, useEmployees, type EmployeeRow, type EmployeeStatusFilter } from "@/common/api/employees";
import { useReference } from "@/common/api/reference";
import { BalanceCell } from "@/common/components/BalanceCell";
import { EmptyState } from "@/common/components/EmptyState";
import { errorMessage } from "@/common/lib/errorMessage";
import { formatDay, formatDays } from "@/common/lib/format";
import { readStorage, writeStorage } from "@/common/lib/storage";
import { useToast } from "@/common/toast/ToastProvider";
import { cn } from "@/lib/utils";
import { SkeletonRows } from "@/ui/Skeleton";
import { useOperatorUi } from "../OperatorContext";
import { useDrawerNav } from "../useDrawerNav";
import { EditableCell, type Move } from "./EditableCell";
import { PortalMenu } from "./PortalMenu";
import { QuickAddRow } from "./QuickAddRow";

const FIELDS = ["departmentId", "jobTitle", "email", "employeeCode", "annualAllowanceOverride"] as const;
type Field = (typeof FIELDS)[number];
const FILTER_KEY = "leave.employeeFilter";
const FILTERS: EmployeeStatusFilter[] = ["active", "archived", "all"];

/** Builds the PATCH body for one edited cell, or null when nothing changed. Throws an i18n key on bad input. */
export function buildPatch(row: EmployeeRow, field: Field, raw: string): EmployeeUpdateInput | null {
  const value = raw.trim();
  switch (field) {
    case "departmentId":
      return value && value !== row.departmentId ? { departmentId: value } : null;
    case "annualAllowanceOverride": {
      const next = value === "" ? null : Number(value.replace(",", "."));
      if (next !== null && (!Number.isFinite(next) || !isHalfStep(next))) throw new Error("errors.halfDayStep");
      return next === row.annualAllowanceOverride ? null : { annualAllowanceOverride: next };
    }
    default: {
      const next = value === "" ? null : value;
      return next === row[field] ? null : { [field]: next };
    }
  }
}

export default function EmployeesPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const location = useLocation();
  const toast = useToast();
  const nav = useDrawerNav();
  const { search } = useOperatorUi();
  const [filter, setFilter] = useState<EmployeeStatusFilter>(() => {
    const saved = readStorage(FILTER_KEY, true);
    return FILTERS.includes(saved as EmployeeStatusFilter) ? (saved as EmployeeStatusFilter) : "active";
  });
  const [editing, setEditing] = useState<{ id: string; field: Field } | null>(null);
  const employees = useEmployees(filter);
  const reference = useReference();
  const mutations = useEmployeeMutations();

  useEffect(() => writeStorage(FILTER_KEY, filter, true), [filter]);
  useEffect(() => {
    // `E` from another page lands here and asks for the quick-add focus.
    if ((location.state as { focusQuickAdd?: boolean } | null)?.focusQuickAdd) {
      requestAnimationFrame(() => document.getElementById("quick-add-name")?.focus());
    }
  }, [location.state, employees.isSuccess]);

  const deducting = useMemo(() => (reference.data?.leaveTypes ?? []).filter((x) => x.deductsBalance), [reference.data]);
  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase(locale);
    return (employees.data ?? []).filter((r) => !q || r.fullName.toLocaleLowerCase(locale).includes(q) || (r.employeeCode ?? "").toLocaleLowerCase(locale).includes(q));
  }, [employees.data, search, locale]);

  const columns = 8 + deducting.length;
  const fail = (err: unknown) => toast({ message: errorMessage(t, err), tone: "error" });

  const commit = (row: EmployeeRow, field: Field, raw: string, move: Move) => {
    try {
      const patch = buildPatch(row, field, raw);
      if (patch) mutations.update.mutate({ id: row.id, patch }, { onError: fail });
    } catch (err) {
      toast({ message: t(err instanceof Error ? err.message : "errors.generic"), tone: "error" });
    }
    const next = FIELDS[FIELDS.indexOf(field) + move];
    setEditing(move !== 0 && next ? { id: row.id, field: next } : null);
  };

  const toggleArchive = (row: EmployeeRow) => {
    const archiving = row.status === "active";
    const call = archiving ? mutations.archive : mutations.restore;
    const inverse = archiving ? mutations.restore : mutations.archive;
    call.mutate(row.id, {
      onSuccess: () =>
        toast({
          message: t(archiving ? "employees.archived" : "employees.restored", { name: row.fullName }),
          onUndo: () => inverse.mutateAsync(row.id).then(() => undefined),
        }),
      onError: fail,
    });
  };

  const labels: Record<Field, string> = {
    departmentId: t("employees.col.department"),
    jobTitle: t("employees.col.jobTitle"),
    email: t("employees.col.email"),
    employeeCode: t("employees.col.code"),
    annualAllowanceOverride: t("employees.col.allowance"),
  };
  const cell = (row: EmployeeRow, field: Field, raw: string, display: React.ReactNode, extra: Partial<React.ComponentProps<typeof EditableCell>> = {}) => (
    <EditableCell
      label={`${labels[field]}: ${row.fullName}`}
      value={raw}
      editing={editing?.id === row.id && editing.field === field}
      onStart={() => setEditing({ id: row.id, field })}
      onCommit={(v, move) => commit(row, field, v, move)}
      onCancel={() => setEditing(null)}
      {...extra}
    >
      {display}
    </EditableCell>
  );

  const th = "h-9 whitespace-nowrap px-3 text-start font-medium";
  return (
    <section className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="text-[15px] font-semibold">{t("nav.employees")}</h1>
        <div role="radiogroup" aria-label={t("employees.filter")} className="ms-auto inline-flex rounded-md border p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              onClick={() => setFilter(f)}
              className={cn("h-7 rounded px-2.5 text-meta max-md:h-9", filter === f ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted")}
            >
              {t(`employees.filters.${f}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {employees.isPending || reference.isPending ? (
          <SkeletonRows label={t("common.loading")} cols={7} rows={8} />
        ) : employees.isError || !reference.data ? (
          <EmptyState message={errorMessage(t, employees.error ?? reference.error)} actionLabel={t("common.retry")} onAction={() => void employees.refetch()} />
        ) : (
          <>
            <table className="w-full min-w-[1100px] text-table">
              <thead className="sticky top-0 z-10 bg-background text-meta text-muted-foreground shadow-[0_1px_0_var(--border)]">
                <tr>
                  <th scope="col" className={th}>{t("employees.col.name")}</th>
                  <th scope="col" className={th}>{labels.departmentId}</th>
                  <th scope="col" className={th}>{t("employees.col.hireDate")}</th>
                  <th scope="col" className={th}>{labels.jobTitle}</th>
                  <th scope="col" className={th}>{labels.email}</th>
                  <th scope="col" className={th}>{labels.employeeCode}</th>
                  <th scope="col" className={cn(th, "text-end")}>{labels.annualAllowanceOverride}</th>
                  {deducting.map((x) => (
                    <th key={x.id} scope="col" className={cn(th, "text-end")}>{x.name}</th>
                  ))}
                  <th scope="col" className={th}>{t("employees.col.portal")}</th>
                  <th scope="col" className="h-9 w-20 px-3"><span className="sr-only">{t("employees.col.actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={cn("h-9 border-b hover:bg-muted/40", r.status === "archived" && "text-muted-foreground")}>
                    <td className="px-3">
                      <button type="button" onClick={() => nav.open(`/employees/${r.id}`)} className="font-medium underline-offset-2 hover:underline">
                        {r.fullName}
                      </button>
                      {r.status === "archived" ? <span className="ms-2 rounded border px-1.5 text-meta">{t("employees.statusArchived")}</span> : null}
                    </td>
                    {cell(r, "departmentId", r.departmentId, r.departmentName, {
                      options: reference.data.departments.map((d) => ({ value: d.id, label: d.name })),
                    })}
                    <td className="px-3 tabular-nums">{formatDay(r.hireDate, locale, { day: "numeric", month: "short", year: "numeric" })}</td>
                    {cell(r, "jobTitle", r.jobTitle ?? "", r.jobTitle ?? <span aria-hidden="true">—</span>)}
                    {cell(r, "email", r.email ?? "", r.email ?? <span aria-hidden="true">—</span>, { type: "email", inputMode: "email" })}
                    {cell(r, "employeeCode", r.employeeCode ?? "", r.employeeCode ?? <span aria-hidden="true">—</span>)}
                    {cell(r, "annualAllowanceOverride", r.annualAllowanceOverride === null ? "" : String(r.annualAllowanceOverride), r.annualAllowanceOverride === null ? <span aria-hidden="true">—</span> : formatDays(r.annualAllowanceOverride, locale), {
                      inputMode: "decimal",
                      className: "text-end tabular-nums",
                    })}
                    {deducting.map((x) => {
                      const b = r.balances[x.id];
                      return (
                        <td key={x.id} className="px-3 text-end">
                          {b ? <BalanceCell available={b.available} taken={b.taken} pending={b.pending} /> : <span aria-hidden="true">—</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 text-meta">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn("h-1.5 w-1.5 rounded-full", r.portalAccess ? "bg-status-approved" : "bg-status-cancelled")} aria-hidden="true" />
                        {r.portalAccess ? t("portal.on") : t("portal.off")}
                      </span>
                    </td>
                    <td className="px-2">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          onClick={() => toggleArchive(r)}
                          aria-label={t(r.status === "active" ? "employees.archive" : "employees.restore", { name: r.fullName })}
                          title={t(r.status === "active" ? "employees.archive" : "employees.restore", { name: r.fullName })}
                          className="grid h-8 w-8 place-items-center rounded hover:bg-muted max-md:h-11 max-md:w-11"
                        >
                          {r.status === "active" ? <Archive size={15} aria-hidden="true" /> : <ArchiveRestore size={15} aria-hidden="true" />}
                        </button>
                        <PortalMenu employee={r} mutations={mutations} />
                      </div>
                    </td>
                  </tr>
                ))}
                <QuickAddRow reference={reference.data} deducting={deducting} mutations={mutations} columns={columns} />
              </tbody>
            </table>
            {rows.length === 0 ? (
              search || filter === "archived" ? (
                <EmptyState message={t("workspace.noMatch")} />
              ) : (
                <EmptyState message={t("employees.empty")} actionLabel={t("employees.quickAdd.focus")} onAction={() => document.getElementById("quick-add-name")?.focus()} />
              )
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
