// Latest approval / rejection at the top of Home until dismissed (spec 1.7). Props-only.
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PortalDecision } from "@/common/api/portal";
import { formatRange } from "@/common/lib/format";
import { cn } from "@/lib/utils";

export function DecisionBanner({ decision, onDismiss }: { decision: PortalDecision; onDismiss: () => void }) {
  const { t, i18n } = useTranslation();
  const approved = decision.kind === "approved";
  const range = formatRange(decision.leave.startDate, decision.leave.endDate, i18n.language, t("common.to"));
  return (
    <div
      role="status"
      className={cn("flex items-start gap-3 rounded-lg border p-3", approved ? "border-status-approved/40 bg-status-approved/5" : "border-status-rejected/40 bg-status-rejected/5")}
    >
      {approved ? (
        <Check size={18} className="mt-0.5 shrink-0 text-status-approved" aria-hidden="true" />
      ) : (
        <X size={18} className="mt-0.5 shrink-0 text-status-rejected" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t(approved ? "portal.decision.approved" : "portal.decision.rejected", { type: decision.leave.leaveTypeName, range })}</p>
        {!approved && decision.leave.rejectReason ? <p className="text-muted-foreground">{t("leave.rejectedBecause", { reason: decision.leave.rejectReason })}</p> : null}
      </div>
      <button type="button" onClick={onDismiss} aria-label={t("common.dismiss")} className="-m-1 grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-muted">
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
