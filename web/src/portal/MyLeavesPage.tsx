// My leaves (spec 1.7): history grouped by year, newest first. Withdraw only while pending.
import { useTranslation } from "react-i18next";
import { usePortalLeaves, type PortalLeaveItem } from "@/common/api/portal";
import { EmptyState } from "@/common/components/EmptyState";
import { errorMessage } from "@/common/lib/errorMessage";
import { Skeleton } from "@/ui/Skeleton";
import { LeaveCard } from "./components/LeaveCard";
import { useWithdraw } from "./useWithdraw";

export function groupByYear(rows: readonly PortalLeaveItem[]): Array<{ year: string; rows: PortalLeaveItem[] }> {
  const groups = new Map<string, PortalLeaveItem[]>();
  for (const r of rows) {
    const year = r.startDate.slice(0, 4);
    groups.set(year, [...(groups.get(year) ?? []), r]);
  }
  return [...groups].map(([year, list]) => ({ year, rows: list })).sort((a, b) => b.year.localeCompare(a.year));
}

export default function MyLeavesPage() {
  const { t } = useTranslation();
  const leaves = usePortalLeaves();
  const withdraw = useWithdraw();

  if (leaves.isPending) {
    return (
      <div className="space-y-3" role="status" aria-label={t("common.loading")}>
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  }
  if (leaves.error || !leaves.data) {
    return (
      <p role="alert" className="text-status-rejected">
        {errorMessage(t, leaves.error)}
      </p>
    );
  }
  if (leaves.data.length === 0) return <EmptyState message={t("portal.myLeaves.empty")} />;

  return (
    <div className="space-y-5">
      {groupByYear(leaves.data).map((g) => (
        <section key={g.year} className="space-y-2" aria-label={g.year}>
          <h2 className="font-medium tabular-nums">{g.year}</h2>
          <ul className="space-y-2">
            {g.rows.map((l) => (
              <LeaveCard key={l.id} leave={l} onWithdraw={withdraw} approvedHint />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
