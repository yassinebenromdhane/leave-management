// Withdraw flow shared by Home and My leaves: confirm (it cannot be undone), then the optimistic action.
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PortalLeaveItem } from "@/common/api/portal";
import { ConfirmDialog } from "@/ui/Dialog";
import { usePortalActions } from "./usePortalActions";

export function useWithdraw(): { ask: (leave: PortalLeaveItem) => void; dialog: ReactNode } {
  const { t } = useTranslation();
  const actions = usePortalActions();
  const [target, setTarget] = useState<PortalLeaveItem | null>(null);
  const dialog = target ? (
    <ConfirmDialog
      title={t("portal.withdrawTitle")}
      message={t("portal.withdrawMessage")}
      confirmLabel={t("portal.withdraw")}
      destructive
      onCancel={() => setTarget(null)}
      onConfirm={() => {
        const id = target.id;
        setTarget(null);
        void actions.withdraw(id);
      }}
    />
  ) : null;
  return { ask: setTarget, dialog };
}
