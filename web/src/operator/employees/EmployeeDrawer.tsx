// Employee drawer (spec 1.1): balance cards, leave history, ledger per type and manual adjustment.
// 480 px slide-over; the page behind it stays visible.
import { Archive, ArchiveRestore, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { useEmployeeDetail, useEmployeeMutations } from "@/common/api/employees";
import { useReference } from "@/common/api/reference";
import { BalanceCell } from "@/common/components/BalanceCell";
import { LeaveTypeChip } from "@/common/components/LeaveTypeChip";
import { StatusPill } from "@/common/components/StatusPill";
import { errorMessage } from "@/common/lib/errorMessage";
import { formatDay, formatDays, formatRange } from "@/common/lib/format";
import { useToast } from "@/common/toast/ToastProvider";
import { cn } from "@/lib/utils";
import { Sheet } from "@/ui/Sheet";
import { Skeleton } from "@/ui/Skeleton";
import { useDrawerNav } from "../useDrawerNav";
import { AdjustBalanceForm } from "./AdjustBalanceForm";

export default function EmployeeDrawer() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const nav = useDrawerNav();
  const toast = useToast();
  const detail = useEmployeeDetail(id);
  const reference = useReference();
  const mutations = useEmployeeMutations();
  const [ledgerType, setLedgerType] = useState<string | null>(null);

  const failed = detail.error ?? reference.error;
  if (!detail.data || !reference.data) {
    return (
      <Sheet title={t("employees.drawerTitle")} onClose={nav.close}>
        <div className="space-y-3 p-4" role="status" aria-label={t("common.loading")}>
          {failed ? (
            <p role="alert" className="text-status-rejected">
              {errorMessage(t, failed)}
            </p>
          ) : (
            <>
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-20" />
              <Skeleton className="h-40" />
            </>
          )}
        </div>
      </Sheet>
    );
  }

  const { employee, balances, ledger, leaves } = detail.data;
  const deducting = reference.data.leaveTypes.filter((x) => x.deductsBalance);
  const typeName = new Map(reference.data.leaveTypes.map((x) => [x.id, x]));
  const activeLedgerType = ledgerType ?? deducting[0]?.id ?? "";
  const lines = ledger[activeLedgerType] ?? [];
  const archived = employee.status === "archived";

  const toggleArchive = () => {
    const call = archived ? mutations.restore : mutations.archive;
    const inverse = archived ? mutations.archive : mutations.restore;
    call.mutate(employee.id, {
      onSuccess: () => toast({ message: t(archived ? "employees.restored" : "employees.archived", { name: employee.fullName }), onUndo: () => inverse.mutateAsync(employee.id).then(() => undefined) }),
      onError: (err) => toast({ message: errorMessage(t, err), tone: "error" }),
    });
  };

  return (
    <Sheet
      title={employee.fullName}
      onClose={nav.close}
      headerExtra={archived ? <span className="rounded border px-1.5 text-meta text-muted-foreground">{t("employees.statusArchived")}</span> : null}
    >
      <div className="space-y-5 p-4">
        <section className="space-y-2">
          <p className="text-muted-foreground">
            {[employee.departmentName, employee.jobTitle, t("employees.hiredOn", { date: formatDay(employee.hireDate, locale, { day: "numeric", month: "short", year: "numeric" }) })].filter(Boolean).join(" · ")}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={archived} onClick={() => nav.open(`/leave/new?employee=${employee.id}`)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-accent-foreground disabled:opacity-50 max-md:h-11">
              <Plus size={14} aria-hidden="true" />
              {t("topbar.logLeave")}
            </button>
            <button type="button" onClick={toggleArchive} className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 hover:bg-muted max-md:h-11">
              {archived ? <ArchiveRestore size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}
              {t(archived ? "employees.restoreShort" : "employees.archiveShort")}
            </button>
          </div>
        </section>

        <section aria-label={t("employees.balances")}>
          <h3 className="mb-2 text-meta font-medium uppercase tracking-wide text-muted-foreground">{t("employees.balances")}</h3>
          <div className="grid grid-cols-2 gap-2">
            {deducting.map((x) => {
              const b = balances[x.id];
              return (
                <div key={x.id} className="space-y-1.5 rounded-md border p-3">
                  <LeaveTypeChip name={x.name} color={x.color} />
                  {b ? <BalanceCell available={b.available} taken={b.taken} pending={b.pending} /> : <span className="text-muted-foreground">—</span>}
                </div>
              );
            })}
          </div>
        </section>

        <section aria-label={t("employees.history")}>
          <h3 className="mb-2 text-meta font-medium uppercase tracking-wide text-muted-foreground">{t("employees.history")}</h3>
          {leaves.length === 0 ? (
            <p className="text-muted-foreground">{t("employees.noLeaves")}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {leaves.map((l) => (
                <li key={l.id}>
                  <button type="button" onClick={() => nav.open(`/leave/${l.id}`)} className="flex min-h-9 w-full items-center gap-2 px-3 text-start hover:bg-muted/50 max-md:min-h-11">
                    <span className="min-w-0 flex-1 truncate tabular-nums">{formatRange(l.startDate, l.endDate, locale, t("common.to"))}</span>
                    <LeaveTypeChip name={l.leaveTypeName} color={l.color} />
                    <span className="w-10 text-end tabular-nums">{formatDays(l.workingDays, locale)}</span>
                    <StatusPill status={l.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label={t("ledger.title")}>
          <h3 className="mb-2 text-meta font-medium uppercase tracking-wide text-muted-foreground">{t("ledger.title")}</h3>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {deducting.map((x) => (
              <LeaveTypeChip key={x.id} name={x.name} color={x.color} selected={x.id === activeLedgerType} onClick={() => setLedgerType(x.id)} />
            ))}
          </div>
          {lines.length === 0 ? (
            <p className="text-muted-foreground">{t("ledger.empty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[420px] text-table">
                <thead className="text-meta text-muted-foreground">
                  <tr className="h-8 border-b">
                    <th scope="col" className="px-2 text-start font-medium">{t("ledger.date")}</th>
                    <th scope="col" className="px-2 text-start font-medium">{t("ledger.entry")}</th>
                    <th scope="col" className="px-2 text-end font-medium">{t("ledger.days")}</th>
                    <th scope="col" className="px-2 text-end font-medium">{t("ledger.running")}</th>
                    <th scope="col" className="px-2 text-start font-medium">{t("ledger.note")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="h-9 border-b last:border-b-0">
                      <td className="px-2 tabular-nums">{formatDay(l.effectiveDate, locale, { day: "numeric", month: "short", year: "numeric" })}</td>
                      <td className="px-2">{t(`ledger.entryType.${l.entryType}`)}</td>
                      <td className={cn("px-2 text-end tabular-nums", l.days < 0 && "text-muted-foreground")}>{formatDays(l.days, locale, true)}</td>
                      <td className={cn("px-2 text-end font-medium tabular-nums", l.runningBalance < 0 && "text-balance-negative")}>{formatDays(l.runningBalance, locale)}</td>
                      <td className="max-w-40 truncate px-2 text-muted-foreground" title={l.note ?? undefined}>{l.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-label={t("ledger.adjust")}>
          <h3 className="mb-2 text-meta font-medium uppercase tracking-wide text-muted-foreground">{t("ledger.adjust")}</h3>
          <AdjustBalanceForm
            leaveTypes={deducting}
            onSubmit={async (input) => {
              await mutations.adjust.mutateAsync({ id: employee.id, input });
              toast({
                message: t("ledger.adjusted", { type: typeName.get(input.leaveTypeId)?.name ?? "", days: formatDays(input.days, locale, true) }),
                // Undo is the inverse adjustment (the ledger is append-only).
                onUndo: () =>
                  mutations.adjust
                    .mutateAsync({ id: employee.id, input: { ...input, days: -input.days, note: t("ledger.undoNote", { note: input.note }) } })
                    .then(() => undefined)
                    .catch((err) => toast({ message: errorMessage(t, err), tone: "error" })),
              });
            }}
          />
        </section>
      </div>
    </Sheet>
  );
}
