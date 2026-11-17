// Operator leave hooks and raw calls over /api/operator/leaves. The optimistic + Undo wiring lives
// in operator/useLeaveActions.ts; these are the typed building blocks.
import type { LeaveCreateInput, LeaveListQuery, LeavePreviewInput, LeaveUpdateInput } from "@leave/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { unwrap } from "./http";
import { queryKeys } from "./keys";

const fetchLeaves = (filters: LeaveListQuery) => unwrap(api.api.operator.leaves.$get({ query: filters }));
const fetchLeave = (id: string) => unwrap(api.api.operator.leaves[":id"].$get({ param: { id } }));
const postPreview = (input: LeavePreviewInput) => unwrap(api.api.operator.leaves.preview.$post({ json: input }));

export type LeaveRow = Awaited<ReturnType<typeof fetchLeaves>>[number];
export type LeaveDetail = Awaited<ReturnType<typeof fetchLeave>>;
export type LeavePreviewResult = Awaited<ReturnType<typeof postPreview>>;

export function useLeaves(filters: LeaveListQuery) {
  return useQuery({
    queryKey: queryKeys.leaves(filters),
    queryFn: () => fetchLeaves(filters),
    refetchInterval: 30_000, // polling fallback until the SSE channel exists
    placeholderData: keepPreviousData, // keeps the timeline on screen while the period changes
  });
}

export function useLeave(id: string | undefined) {
  return useQuery({ queryKey: queryKeys.leave(id ?? ""), queryFn: () => fetchLeave(id as string), enabled: Boolean(id) });
}

/** Server-side facts the browser cannot compute alone: other leaves, ledger balance, colleagues off. */
export function useLeavePreview(input: LeavePreviewInput | null) {
  return useQuery({
    queryKey: queryKeys.leavePreview(input ?? {}),
    queryFn: () => postPreview(input as LeavePreviewInput),
    enabled: input !== null,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}

export const leaveApi = {
  create: (input: LeaveCreateInput) => unwrap(api.api.operator.leaves.$post({ json: input })),
  update: (id: string, input: LeaveUpdateInput) => unwrap(api.api.operator.leaves[":id"].$patch({ param: { id }, json: input })),
  setStatus: (id: string, status: LeaveRow["status"], reason?: string) =>
    unwrap(api.api.operator.leaves[":id"].status.$post({ param: { id }, json: { status, reason } })),
  bulkApprove: (ids: string[]) => unwrap(api.api.operator.leaves["bulk-status"].$post({ json: { ids, status: "approved" } })),
  remove: (id: string) => unwrap(api.api.operator.leaves[":id"].$delete({ param: { id } })),
  restore: (id: string) => unwrap(api.api.operator.leaves[":id"].restore.$post({ param: { id } })),
  upload: (id: string, file: File) => unwrap(api.api.operator.leaves[":id"].attachments.$post({ param: { id }, form: { file } })),
  removeAttachment: (id: string) => unwrap(api.api.operator.attachments[":id"].$delete({ param: { id } })),
};
