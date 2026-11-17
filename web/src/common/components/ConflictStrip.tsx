import { AlertTriangle, Ban } from "lucide-react";
import { useTranslation } from "react-i18next";
import { issueMessage, type IssueLike } from "@/common/lib/issueMessage";

/**
 * Conflict strip of the leave drawer (spec 1.3). Blocking issues disable save and link to the
 * clashing leave; warnings are informational and saving through them needs no extra click.
 */
export function ConflictStrip({
  blocking,
  warnings,
  onOpenLeave,
}: {
  blocking: readonly IssueLike[];
  warnings: readonly IssueLike[];
  onOpenLeave?: (leaveId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  if (blocking.length === 0 && warnings.length === 0) return null;
  return (
    <ul className="space-y-1.5" data-testid="conflict-strip">
      {blocking.map((issue, i) => {
        const leaveId = typeof issue.params?.leaveId === "string" ? issue.params.leaveId : null;
        return (
          <li key={`b${i}`} role="alert" className="flex items-start gap-2 rounded-md border border-status-rejected/40 bg-status-rejected/5 px-3 py-2 text-status-rejected">
            <Ban size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{t("conflicts.blocking")}: </span>
              {issueMessage(t, issue, i18n.language)}
              {leaveId && onOpenLeave ? (
                <>
                  {" "}
                  <button type="button" onClick={() => onOpenLeave(leaveId)} className="underline underline-offset-2">
                    {t("conflicts.openLeave")}
                  </button>
                </>
              ) : null}
            </span>
          </li>
        );
      })}
      {warnings.map((issue, i) => (
        <li key={`w${i}`} className="flex items-start gap-2 rounded-md border border-status-pending/40 bg-status-pending/5 px-3 py-2 text-foreground">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-status-pending" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">{t("conflicts.warning")}: </span>
            {issueMessage(t, issue, i18n.language)}
          </span>
        </li>
      ))}
    </ul>
  );
}
