// One of the employee's own leaves (Home pending/upcoming, My leaves). Props-only.
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LeaveTypeChip } from "@/common/components/LeaveTypeChip";
import { StatusPill } from "@/common/components/StatusPill";
import type { PortalLeaveItem } from "@/common/api/portal";
import { formatDays, formatRange } from "@/common/lib/format";

export function LeaveCard({
  leave,
  onWithdraw,
  approvedHint,
}: {
  leave: PortalLeaveItem;
  /** Offered only while the leave is pending. */
  onWithdraw?: (leave: PortalLeaveItem) => void;
  /** Shows "contact HR to change it" on approved leaves instead of a button. */
  approvedHint?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  return (
    <li className="space-y-2 rounded-lg border p-3" data-testid="leave-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] font-medium tabular-nums">{formatRange(leave.startDate, leave.endDate, locale, t("common.to"))}</p>
          <p className="text-meta text-muted-foreground tabular-nums">
            {t("portal.days", { count: leave.workingDays, formatted: formatDays(leave.workingDays, locale) })}
          </p>
        </div>
        <StatusPill status={leave.status} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <LeaveTypeChip name={leave.leaveTypeName} color={leave.color} />
        {leave.addedByHr ? <span className="rounded border px-1.5 text-meta text-muted-foreground">{t("portal.addedByHr")}</span> : null}
        {leave.changedByHr ? <span className="rounded border px-1.5 text-meta text-muted-foreground">{t("portal.changedByHr")}</span> : null}
      </div>
      {leave.status === "rejected" && leave.rejectReason ? (
        <p className="text-status-rejected">{t("leave.rejectedBecause", { reason: leave.rejectReason })}</p>
      ) : null}
      {leave.status === "pending" && onWithdraw ? (
        <button type="button" onClick={() => onWithdraw(leave)} className="h-11 w-full rounded-md border text-foreground hover:bg-muted">
          {t("portal.withdraw")}
        </button>
      ) : null}
      {leave.status === "approved" && approvedHint ? <p className="text-meta text-muted-foreground">{t("portal.contactHr")}</p> : null}
    </li>
  );
}

/** A request still waiting for a connection: "Sending…", never a made-up server status. */
export function QueuedCard({
  typeName,
  start,
  end,
  fileLost,
  onDiscard,
}: {
  typeName: string;
  start: string;
  end: string;
  fileLost: boolean;
  onDiscard: () => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <li className="space-y-2 rounded-lg border border-dashed p-3" data-testid="queued-card">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[15px] font-medium tabular-nums">
          {typeName} · {formatRange(start, end, i18n.language, t("common.to"))}
        </p>
        <span className="inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-meta">
          <Clock size={11} aria-hidden="true" />
          {t("portal.outbox.sending")}
        </span>
      </div>
      {fileLost ? <p className="text-meta text-status-pending">{t("portal.outbox.fileLost")}</p> : null}
      <button type="button" onClick={onDiscard} className="h-11 w-full rounded-md border hover:bg-muted">
        {t("portal.outbox.discard")}
      </button>
    </li>
  );
}
