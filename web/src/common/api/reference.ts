import { addIsoDays } from "@leave/shared";
import { useQuery } from "@tanstack/react-query";
import { todayIso } from "@/common/lib/date";
import { api } from "./client";
import { unwrap } from "./http";
import { queryKeys } from "./keys";

async function fetchReference(from: string, to: string) {
  return unwrap(api.api.operator.reference.$get({ query: { from, to } }));
}
export type Reference = Awaited<ReturnType<typeof fetchReference>>;
export type LeaveTypeRef = Reference["leaveTypes"][number];

/** Work pattern, leave types, departments and holidays. A wide window so one query serves every drawer. */
export function useReference() {
  const year = Number(todayIso().slice(0, 4));
  const from = `${year - 1}-01-01`;
  const to = addIsoDays(`${year + 2}-01-01`, -1);
  return useQuery({
    queryKey: queryKeys.reference,
    queryFn: () => fetchReference(from, to),
    staleTime: 5 * 60_000,
  });
}
