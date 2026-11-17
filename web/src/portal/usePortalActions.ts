// Portal mutations: submit (queued when offline), withdraw (optimistic with rollback). Undo is
// always the inverse server action, never a cache revert (CLAUDE.md, frontend rules): Undo of a
// submit is a withdraw, Undo of a withdraw is a restore.
import type { PortalLeaveSubmitInput } from "@leave/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryKeys } from "@/common/api/keys";
import { portalApi, type PortalDashboard, type PortalLeaveItem } from "@/common/api/portal";
import { errorMessage } from "@/common/lib/errorMessage";
import { useToast } from "@/common/toast/ToastProvider";
import { outbox } from "./offline/outbox";
import { refreshPortal } from "./refresh";

export type SubmitOutcome = "sent" | "queued";

export function usePortalActions() {
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();

  /** Undo of a withdraw: the server puts the request back to Pending (or refuses with a reason). */
  async function restore(id: string): Promise<boolean> {
    try {
      await portalApi.restore(id);
      toast({ message: t("portal.toast.restored") });
      return true;
    } catch (err) {
      toast({ message: errorMessage(t, err), tone: "error" });
      return false;
    } finally {
      void refreshPortal(qc);
    }
  }

  /**
   * Withdraw, no confirmation (spec 2.3: only destructive actions confirm; this one has Undo). The
   * row leaves "Pending" at once; a refusal (409 already decided) rolls it back.
   */
  async function withdraw(id: string, announce = true): Promise<boolean> {
    await qc.cancelQueries({ queryKey: queryKeys.portal });
    const dash = qc.getQueryData<PortalDashboard>(queryKeys.portalDashboard);
    const list = qc.getQueryData<PortalLeaveItem[]>(queryKeys.portalLeaves);
    qc.setQueryData<PortalDashboard>(queryKeys.portalDashboard, (d) => (d ? { ...d, pending: d.pending.filter((l) => l.id !== id) } : d));
    qc.setQueryData<PortalLeaveItem[]>(queryKeys.portalLeaves, (rows) => rows?.map((l) => (l.id === id ? { ...l, status: "cancelled" as const } : l)));
    try {
      await portalApi.withdraw(id);
      if (announce) toast({ message: t("portal.toast.withdrawn"), onUndo: () => void restore(id) });
      return true;
    } catch (err) {
      qc.setQueryData(queryKeys.portalDashboard, dash);
      qc.setQueryData(queryKeys.portalLeaves, list);
      toast({ message: errorMessage(t, err), tone: "error" });
      return false;
    } finally {
      void refreshPortal(qc);
    }
  }

  /**
   * Online: POST, haptic tick, 6 s Undo toast (Undo = withdraw). Offline or network failure: the
   * payload is queued and shown as "Sending…". Server refusals (422...) throw to the sheet.
   */
  async function submit(payload: PortalLeaveSubmitInput, file: File | null, typeName: string): Promise<SubmitOutcome> {
    const queue = (): SubmitOutcome => {
      outbox.enqueue(payload, typeName, file);
      toast({ message: file ? t("portal.toast.queuedFile") : t("portal.toast.queued") });
      return "queued";
    };
    if (!navigator.onLine) return queue();
    try {
      const row = await portalApi.submit(payload, file);
      navigator.vibrate?.(10);
      toast({ message: t("portal.toast.sent"), onUndo: () => void withdraw(row.id) });
      void refreshPortal(qc);
      return "sent";
    } catch (err) {
      if (err instanceof TypeError) return queue(); // fetch failed: no connection
      throw err;
    }
  }

  return { submit, withdraw, restore };
}
