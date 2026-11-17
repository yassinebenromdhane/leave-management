// Portal Home (spec 1.7): decision banner, balance cards, pending, upcoming, next holidays.
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { queryKeys } from "@/common/api/keys";
import { portalApi, usePortalDashboard, usePortalLeaves, usePortalReference } from "@/common/api/portal";
import { EmptyState } from "@/common/components/EmptyState";
import { errorMessage } from "@/common/lib/errorMessage";
import { formatDay, formatDays } from "@/common/lib/format";
import { Skeleton } from "@/ui/Skeleton";
import { BalanceCards } from "./components/BalanceCards";
import { DecisionBanner } from "./components/DecisionBanner";
import { LeaveCard, QueuedCard } from "./components/LeaveCard";
import { LedgerSheet } from "./components/LedgerSheet";
import { outbox } from "./offline/outbox";
import { useOutboxItems } from "./offline/useOutbox";
import { useWithdraw } from "./useWithdraw";

export default function HomePage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const qc = useQueryClient();
  const dashboard = usePortalDashboard();
  const leaves = usePortalLeaves();
  const reference = usePortalReference();
  const queued = useOutboxItems();
  const withdraw = useWithdraw();
  const [ledgerFor, setLedgerFor] = useState<{ id: string; name: string } | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);

  if (dashboard.isPending) {
    return (
      <div className="space-y-3" role="status" aria-label={t("common.loading")}>
        <Skeleton className="h-24" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  }
  if (dashboard.error || !dashboard.data) {
    return (
      <p role="alert" className="text-status-rejected">
        {errorMessage(t, dashboard.error)}
      </p>
    );
  }
  const d = dashboard.data;
  const decision = d.decision && !dismissed.includes(d.decision.notificationId) ? d.decision : null;

  const dismiss = async (notificationId: string) => {
    setDismissed((x) => [...x, notificationId]); // hide at once; the server marks it read
    try {
      await portalApi.markRead(notificationId);
    } catch {
      setDismissed((x) => x.filter((id) => id !== notificationId)); // still unread: keep showing it
    } finally {
      void qc.invalidateQueries({ queryKey: queryKeys.portalDashboard });
    }
  };

  // First login: nothing requested yet. The figure is the live paid balance from the server.
  const noLeavesYet = leaves.data !== undefined && leaves.data.length === 0 && queued.length === 0;
  const paidId = reference.data?.leaveTypes.find((x) => x.code === "paid")?.id;
  const paid = d.balances.find((b) => b.leaveTypeId === paidId);

  return (
    <div className="space-y-5">
      {decision ? <DecisionBanner decision={decision} onDismiss={() => void dismiss(decision.notificationId)} /> : null}

      <BalanceCards balances={d.balances} onSelect={(b) => setLedgerFor({ id: b.leaveTypeId, name: b.name })} />

      {noLeavesYet ? (
        <EmptyState
          message={
            paid
              ? t("portal.empty.withBalance", { count: paid.available, formatted: formatDays(paid.available, locale) })
              : t("portal.empty.generic")
          }
        />
      ) : (
        <>
          {d.pending.length > 0 || queued.length > 0 ? (
            <section className="space-y-2" aria-label={t("portal.pending")}>
              <h2 className="font-medium">{t("portal.pending")}</h2>
              <ul className="space-y-2">
                {queued.map((q) => (
                  <QueuedCard
                    key={q.id}
                    typeName={q.typeName}
                    start={q.payload.startDate}
                    end={q.payload.endDate}
                    fileLost={outbox.fileLost(q)}
                    onDiscard={() => outbox.remove(q.id)}
                  />
                ))}
                {d.pending.map((l) => (
                  <LeaveCard key={l.id} leave={l} onWithdraw={withdraw.ask} />
                ))}
              </ul>
            </section>
          ) : null}

          {d.upcoming.length > 0 ? (
            <section className="space-y-2" aria-label={t("portal.upcoming")}>
              <h2 className="font-medium">{t("portal.upcoming")}</h2>
              <ul className="space-y-2">
                {d.upcoming.map((l) => (
                  <LeaveCard key={l.id} leave={l} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {d.nextHolidays.length > 0 ? (
        <section className="space-y-2" aria-label={t("portal.holidays")}>
          <h2 className="font-medium">{t("portal.holidays")}</h2>
          <ul className="divide-y rounded-lg border">
            {d.nextHolidays.map((h) => (
              <li key={h.date} className="flex min-h-11 items-center justify-between gap-3 px-3">
                <span>{h.name}</span>
                <span className="text-muted-foreground tabular-nums">{formatDay(h.date, locale, { weekday: "short", day: "numeric", month: "short" })}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {ledgerFor ? <LedgerSheet leaveTypeId={ledgerFor.id} typeName={ledgerFor.name} onClose={() => setLedgerFor(null)} /> : null}
      {withdraw.dialog}
    </div>
  );
}
