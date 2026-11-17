// Read-only ledger of one balance, newest first, with the running balance (spec 1.7).
import { useTranslation } from "react-i18next";
import { usePortalLedger } from "@/common/api/portal";
import { errorMessage } from "@/common/lib/errorMessage";
import { formatDay, formatDays } from "@/common/lib/format";
import { Sheet } from "@/ui/Sheet";
import { Skeleton } from "@/ui/Skeleton";

export function LedgerSheet({ leaveTypeId, typeName, onClose }: { leaveTypeId: string; typeName: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const ledger = usePortalLedger(leaveTypeId);
  const locale = i18n.language;
  const rows = [...(ledger.data?.entries ?? [])].reverse();
  return (
    <Sheet title={`${t("ledger.title")} · ${typeName}`} onClose={onClose}>
      <div className="p-4">
        {ledger.isPending ? (
          <div className="space-y-2" role="status" aria-label={t("common.loading")}>
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        ) : ledger.error ? (
          <p role="alert" className="text-status-rejected">
            {errorMessage(t, ledger.error)}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground">{t("ledger.empty")}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t(`ledger.entryType.${e.entryType}`)}</p>
                  <p className="truncate text-meta text-muted-foreground">
                    {formatDay(e.effectiveDate, locale, { day: "numeric", month: "short", year: "numeric" })}
                    {e.note ? ` · ${e.note}` : ""}
                  </p>
                </div>
                <span className="w-14 text-end tabular-nums">{formatDays(e.days, locale, true)}</span>
                <span className="w-14 text-end font-medium tabular-nums" aria-label={t("ledger.running")}>
                  {formatDays(e.runningBalance, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
