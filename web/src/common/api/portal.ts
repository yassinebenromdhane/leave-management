// Employee portal hooks and raw calls over /api/me/*. Every id sent is the employee's own row;
// the server derives the employee from the session. Balances always come from the server.
import { addIsoDays, type PortalLeaveSubmitInput, type PortalPreviewInput } from "@leave/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { todayIso } from "@/common/lib/date";
import { api } from "./client";
import { unwrap } from "./http";
import { queryKeys } from "./keys";

const fetchReference = (from: string, to: string) => unwrap(api.api.me.reference.$get({ query: { from, to } }));
const fetchDashboard = () => unwrap(api.api.me.dashboard.$get());
const fetchLeaves = () => unwrap(api.api.me.leaves.$get());
const fetchLedger = (leaveTypeId: string) => unwrap(api.api.me.ledger[":leaveTypeId"].$get({ param: { leaveTypeId } }));
const fetchTeam = (from: string, to: string) => unwrap(api.api.me.team.$get({ query: { from, to } }));
const postPreview = (input: PortalPreviewInput) => unwrap(api.api.me.leaves.preview.$post({ json: input }));

export type PortalReference = Awaited<ReturnType<typeof fetchReference>>;
export type PortalLeaveType = PortalReference["leaveTypes"][number];
export type PortalDashboard = Awaited<ReturnType<typeof fetchDashboard>>;
export type PortalBalance = PortalDashboard["balances"][number];
export type PortalDecision = NonNullable<PortalDashboard["decision"]>;
export type PortalLeaveItem = Awaited<ReturnType<typeof fetchLeaves>>[number];
export type PortalLedger = Awaited<ReturnType<typeof fetchLedger>>;
export type PortalTeam = Awaited<ReturnType<typeof fetchTeam>>;
export type PortalPreviewResult = Awaited<ReturnType<typeof postPreview>>;

/** Leave types, work week and holidays: a wide window so the sheet works from the cache offline. */
export function usePortalReference() {
  const year = Number(todayIso().slice(0, 4));
  const from = `${year - 1}-01-01`;
  const to = addIsoDays(`${year + 2}-01-01`, -1);
  return useQuery({ queryKey: queryKeys.portalReference, queryFn: () => fetchReference(from, to), staleTime: 5 * 60_000 });
}

export function usePortalDashboard() {
  return useQuery({ queryKey: queryKeys.portalDashboard, queryFn: fetchDashboard, refetchInterval: 30_000 });
}

export function usePortalLeaves() {
  return useQuery({ queryKey: queryKeys.portalLeaves, queryFn: fetchLeaves, refetchInterval: 30_000 });
}

export function usePortalLedger(leaveTypeId: string | null) {
  return useQuery({
    queryKey: queryKeys.portalLedger(leaveTypeId ?? ""),
    queryFn: () => fetchLedger(leaveTypeId as string),
    enabled: leaveTypeId !== null,
  });
}

/** The "Away" projection. The Team view refreshes by polling / refocus, never by events. */
export function usePortalTeam(from: string, to: string) {
  return useQuery({ queryKey: queryKeys.portalTeam(from, to), queryFn: () => fetchTeam(from, to), refetchInterval: 30_000 });
}

export function usePortalPreview(input: PortalPreviewInput | null) {
  return useQuery({
    queryKey: queryKeys.portalPreview(input ?? {}),
    queryFn: () => postPreview(input as PortalPreviewInput),
    enabled: input !== null,
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: false,
  });
}

export const portalApi = {
  /** Multipart: `data` is the JSON payload, `file` the optional attachment. */
  submit: (input: PortalLeaveSubmitInput, file?: File | null) =>
    unwrap(api.api.me.leaves.$post({ form: { data: JSON.stringify(input), ...(file ? { file } : {}) } })),
  withdraw: (id: string) => unwrap(api.api.me.leaves[":id"].withdraw.$post({ param: { id } })),
  /** Undo of a withdraw: back to Pending (server allows it for PORTAL_UNDO_WINDOW_MS). */
  restore: (id: string) => unwrap(api.api.me.leaves[":id"].restore.$post({ param: { id } })),
  markRead: (id: string) => unwrap(api.api.me.notifications[":id"].read.$post({ param: { id } })),
};
