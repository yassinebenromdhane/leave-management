// React bindings of the outbox: the list, and the flush that retries on `online` (and on mount).
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/common/api/http";
import { portalApi } from "@/common/api/portal";
import { errorMessage } from "@/common/lib/errorMessage";
import { useToast } from "@/common/toast/ToastProvider";
import { refreshPortal } from "../refresh";
import { outbox, type OutboxItem } from "./outbox";

export const useOutboxItems = (): OutboxItem[] => useSyncExternalStore(outbox.subscribe, outbox.all, outbox.all);

let flushing = false;

/**
 * Mount once in the portal shell with the signed-in user's id: declares the outbox owner (which
 * deletes anything queued by another person on this device) and sends that user's queued requests
 * now and whenever the browser comes back online. Nothing is sent until the user is known.
 */
export function useOutboxFlush(userId: string | null | undefined): void {
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    if (!userId) return;
    outbox.setOwner(userId);
    void outbox.ready(); // load kept documents now, so a lost one is flagged even while offline
    const flush = async () => {
      if (flushing || !navigator.onLine) return;
      flushing = true;
      try {
        await outbox.ready(); // documents kept from before a reload, so none is sent without its file
        for (const item of outbox.all()) {
          if (item.ownerUserId !== userId) continue; // defence in depth

          try {
            await portalApi.submit(item.payload, outbox.fileFor(item.id));
            outbox.remove(item.id);
            navigator.vibrate?.(10);
            toast({ message: t("portal.outbox.sent", { type: item.typeName }) });
          } catch (err) {
            if (!(err instanceof ApiError)) break; // still offline: keep it, try again later
            outbox.remove(item.id); // the server answered "no": say why, do not retry forever
            toast({ message: `${item.typeName}: ${errorMessage(t, err)}`, tone: "error" });
          }
          void refreshPortal(qc);
        }
      } finally {
        flushing = false;
      }
    };
    void flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [qc, toast, t, userId]);
}
