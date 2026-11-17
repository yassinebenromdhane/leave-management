// Optimistic leave mutations with a 6 s Undo toast (spec 2.2). The cache is touched only to show
// the change instantly; the server answer is always refetched, and Undo calls the server inverse.
// Balances are never patched here: employees / employee / leaves keys are invalidated instead.
import type { LeaveCreateInput, LeaveStatus, LeaveUpdateInput } from "@leave/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/common/api/http";
import { invalidateLeaveData } from "@/common/api/invalidate";
import { queryKeys } from "@/common/api/keys";
import { leaveApi, type LeaveDetail, type LeaveRow } from "@/common/api/leaves";
import { errorMessage } from "@/common/lib/errorMessage";
import { useToast } from "@/common/toast/ToastProvider";

export type CreateDisplay = {
  employeeName: string;
  departmentName: string;
  typeName: string;
  color: string;
  workingDays: number;
  status: LeaveStatus;
};

type Snapshots = Array<readonly [readonly unknown[], LeaveRow[] | undefined]>;

export function useLeaveActions() {
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();

  const refresh = () => invalidateLeaveData(qc);
  const fail = (err: unknown) => toast({ message: errorMessage(t, err), tone: "error" });

  const snapshot = async (): Promise<Snapshots> => {
    await qc.cancelQueries({ queryKey: queryKeys.leaves() });
    return qc.getQueriesData<LeaveRow[]>({ queryKey: queryKeys.leaves() });
  };
  const rollback = (snaps: Snapshots) => snaps.forEach(([key, data]) => qc.setQueryData(key, data));
  const patchLists = (fn: (rows: LeaveRow[]) => LeaveRow[]) =>
    qc.setQueriesData<LeaveRow[]>({ queryKey: queryKeys.leaves() }, (rows) => (rows ? fn(rows) : rows));

  /** Run an Undo: call the server inverse, report failures, refetch. */
  const undoWith = (inverse: () => Promise<unknown>) => async () => {
    try {
      await inverse();
    } catch (err) {
      fail(err);
    } finally {
      void refresh();
    }
  };

  /**
   * Create: the row appears at once (temporary id), then the server's row replaces it.
   * Throws after rolling back so the drawer can keep the form open and show the error.
   */
  async function create(input: LeaveCreateInput, display: CreateDisplay, file?: File | null) {
    const snaps = await snapshot();
    patchLists((rows) =>
      [
        ...rows,
        {
          id: `tmp-${Date.now()}`,
          employeeId: input.employeeId,
          employeeName: display.employeeName,
          departmentId: "",
          departmentName: display.departmentName,
          leaveTypeId: input.leaveTypeId,
          leaveTypeName: display.typeName,
          color: display.color,
          startDate: input.startDate,
          endDate: input.endDate,
          startHalf: input.startHalf ?? "full",
          endHalf: input.endHalf ?? "full",
          workingDays: display.workingDays,
          status: display.status,
          note: input.note ?? null,
          rejectReason: null,
          hasWarning: false,
          source: "operator",
          hrChangedAt: null,
          submittedAt: null,
          decidedAt: null,
          createdAt: new Date().toISOString(),
          attachmentCount: 0,
        } as LeaveRow,
      ].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    );
    try {
      const row = await leaveApi.create(input);
      if (file) {
        try {
          await leaveApi.upload(row.id, file);
        } catch (err) {
          fail(err);
        }
      }
      toast({
        message: t("toast.leaveCreated", { name: row.employeeName }),
        onUndo: undoWith(() => leaveApi.remove(row.id)),
      });
      return row;
    } catch (err) {
      rollback(snaps);
      throw err;
    } finally {
      void refresh();
    }
  }

  /** Edit dates / type / note. Server first (an approved leave triggers reversal + new entry). */
  async function update(row: Pick<LeaveRow, "id" | "leaveTypeId" | "startDate" | "endDate" | "startHalf" | "endHalf" | "note">, input: LeaveUpdateInput) {
    const previous: LeaveUpdateInput = {
      leaveTypeId: row.leaveTypeId,
      startDate: row.startDate,
      endDate: row.endDate,
      startHalf: row.startHalf,
      endHalf: row.endHalf,
      note: row.note,
    };
    try {
      const updated = await leaveApi.update(row.id, input);
      toast({ message: t("toast.leaveUpdated"), onUndo: undoWith(() => leaveApi.update(row.id, previous)) });
      return updated;
    } finally {
      void refresh();
    }
  }

  /** Status change by pill, A / R or the drawer buttons. Returns false when the server refused. */
  async function setStatus(row: Pick<LeaveRow, "id" | "status">, status: LeaveStatus, reason?: string): Promise<boolean> {
    if (row.status === status) return true;
    const previous = row.status;
    const snaps = await snapshot();
    patchLists((rows) => rows.map((r) => (r.id === row.id ? { ...r, status, rejectReason: status === "rejected" ? (reason ?? null) : null } : r)));
    qc.setQueryData<LeaveDetail>(queryKeys.leave(row.id), (d) => (d ? { ...d, status } : d));
    try {
      await leaveApi.setStatus(row.id, status, reason);
      toast({
        message: t("toast.statusChanged", { status: t(`status.${status}`).toLocaleLowerCase() }),
        onUndo: undoWith(() => leaveApi.setStatus(row.id, previous)),
      });
      return true;
    } catch (err) {
      rollback(snaps);
      fail(err);
      return false;
    } finally {
      void refresh();
    }
  }

  /** Undo of a bulk approve: approved -> pending for each id; failures are named in their own toast. */
  const undoBulk = (ids: string[], rows: Array<Pick<LeaveRow, "id" | "employeeName">>) => async () => {
    const settled = await Promise.allSettled(ids.map((id) => leaveApi.setStatus(id, "pending")));
    let reverted = 0;
    settled.forEach((res, i) => {
      if (res.status === "fulfilled") return void reverted++;
      const name = rows.find((r) => r.id === ids[i])?.employeeName ?? "";
      toast({ message: `${name}: ${errorMessage(t, res.reason)}`, tone: "error" });
    });
    if (reverted > 0) toast({ message: t("toast.bulkUndone", { count: reverted }) });
    void refresh();
  };

  /** Soft delete; Undo restores. */
  async function remove(row: Pick<LeaveRow, "id" | "employeeName">): Promise<boolean> {
    const snaps = await snapshot();
    patchLists((rows) => rows.filter((r) => r.id !== row.id));
    try {
      await leaveApi.remove(row.id);
      toast({ message: t("toast.leaveDeleted"), onUndo: undoWith(() => leaveApi.restore(row.id)) });
      return true;
    } catch (err) {
      rollback(snaps);
      fail(err);
      return false;
    } finally {
      void refresh();
    }
  }

  /**
   * Bulk approve from the list view. Rows flip at once; each id the server refused is rolled back by
   * the refetch and reported in its own toast (name + reason). Undo sets every approved id back to
   * pending through the status endpoint (the server writes the reversal) and reports failures.
   */
  async function bulkApprove(rows: Array<Pick<LeaveRow, "id" | "employeeName">>): Promise<{ ok: number; failed: number }> {
    const ids = rows.map((r) => r.id);
    const snaps = await snapshot();
    patchLists((list) => list.map((r) => (ids.includes(r.id) ? { ...r, status: "approved" as const } : r)));
    try {
      const { results } = await leaveApi.bulkApprove(ids);
      const failures = results.filter((r) => !r.ok);
      const ok = results.length - failures.length;
      if (ok > 0) {
        const approvedIds = results.filter((r) => r.ok).map((r) => r.id);
        toast({ message: t("toast.bulkApproved", { count: ok }), onUndo: undoBulk(approvedIds, rows) });
      }
      for (const f of failures) {
        const name = rows.find((r) => r.id === f.id)?.employeeName ?? "";
        toast({ message: `${name}: ${errorMessage(t, new ApiError(f.code ?? "errors.generic", 409))}`, tone: "error" });
      }
      return { ok, failed: failures.length };
    } catch (err) {
      rollback(snaps);
      fail(err);
      return { ok: 0, failed: ids.length };
    } finally {
      void refresh();
    }
  }

  return { create, update, setStatus, remove, bulkApprove, fail };
}
