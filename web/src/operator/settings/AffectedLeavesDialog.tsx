// Rule 8 confirm step: after a holiday change, list the leaves whose day count would change and let
// the operator recalculate them (or not now). Zero-day leaves come back as "skipped" with a reason.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/common/api/http";
import { settingsApi, useSettingsWrite, type AffectedLeave } from "@/common/api/settings";
import { StatusPill } from "@/common/components/StatusPill";
import { errorMessage } from "@/common/lib/errorMessage";
import { formatDays, formatRange } from "@/common/lib/format";
import { useToast } from "@/common/toast/ToastProvider";
import { Dialog } from "@/ui/Dialog";
import { GhostButton, PrimaryButton } from "./ui";

export function AffectedLeavesDialog({ leaves, onClose }: { leaves: AffectedLeave[]; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const write = useSettingsWrite();
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState<Array<{ id: string; code: string }> | null>(null);
  const locale = i18n.language;

  const recalc = async () => {
    setBusy(true);
    try {
      const res = await write(() => settingsApi.recalculate(leaves.map((l) => l.id)));
      toast({ message: t("settings.holidays.recalculated", { updated: res.updated, unchanged: res.unchanged }) });
      if (res.skipped.length > 0) setSkipped(res.skipped);
      else onClose();
    } catch (err) {
      toast({ message: errorMessage(t, err), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("settings.holidays.affectedTitle", { count: leaves.length })}
      onClose={onClose}
      className="max-w-2xl"
      actions={
        skipped ? (
          <PrimaryButton onClick={onClose} data-autofocus>
            {t("common.done")}
          </PrimaryButton>
        ) : (
          <>
            <GhostButton onClick={onClose} disabled={busy} data-autofocus>
              {t("settings.holidays.notNow")}
            </GhostButton>
            <PrimaryButton onClick={() => void recalc()} disabled={busy}>
              {t("settings.holidays.recalculate")}
            </PrimaryButton>
          </>
        )
      }
    >
      <p className="mb-3 text-muted-foreground">{t("settings.holidays.affectedMessage")}</p>
      <ul className="max-h-72 divide-y overflow-auto rounded-md border">
        {leaves.map((l) => {
          const skip = skipped?.find((s) => s.id === l.id);
          return (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{l.employeeName}</span>
                <span className="block text-meta text-muted-foreground">
                  {l.leaveTypeName} · {formatRange(l.startDate, l.endDate, locale, t("common.to"))}
                </span>
              </span>
              <StatusPill status={l.status} />
              <span className="tabular-nums">
                {formatDays(l.oldDays, locale)} → {formatDays(l.newDays, locale)}
              </span>
              {skip ? (
                <span role="alert" className="basis-full text-meta text-status-rejected">
                  {t("settings.holidays.skipped")}: {errorMessage(t, new ApiError(skip.code, 422))}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
