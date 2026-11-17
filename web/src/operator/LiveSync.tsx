// Mounts the SSE listener for the operator surface (spec 4.3). The event carries ids only, so the
// "new request" toast waits for the refreshed list and reads the name from there.
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryKeys } from "@/common/api/keys";
import type { LeaveRow } from "@/common/api/leaves";
import { useLeaveEvents, type LeaveEvent } from "@/common/realtime/useLeaveEvents";
import { useToast } from "@/common/toast/ToastProvider";

export function LiveSync() {
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();

  useLeaveEvents("operator", (event: LeaveEvent) => {
    if (event.type !== "leave.submitted") return;
    for (const [, rows] of qc.getQueriesData<LeaveRow[]>({ queryKey: queryKeys.leaves() })) {
      const row = rows?.find((r) => r.id === event.leaveRequestId);
      if (row) return void toast({ message: t("toast.newRequest", { name: row.employeeName }) });
    }
  });
  return null;
}
