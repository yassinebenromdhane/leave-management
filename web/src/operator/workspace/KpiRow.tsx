// KPI cards (spec 2.1 / 2.3): one number, one label, one context line. Each card is a toggle
// filter on the workspace. No charts. Props only.
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { formatDay, formatDays } from "@/common/lib/format";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/ui/Skeleton";
import type { KpiKey } from "./filters";
import { firstName, type Kpis } from "./kpis";

const ORDER: readonly KpiKey[] = ["out", "pending", "upcoming", "low"];

export function kpiContext(key: KpiKey, kpis: Kpis, t: TFunction, locale: string): string {
  const weekday = (date: string) => formatDay(date, locale, { weekday: "short", day: "numeric" });
  switch (key) {
    case "out":
      return kpis.out.backDate
        ? t("kpi.out.back", { count: kpis.out.backCount, day: weekday(kpis.out.backDate) })
        : t("kpi.out.none");
    case "pending":
      if (kpis.pending.oldestDays === null) return t("kpi.pending.none");
      return kpis.pending.oldestDays === 0 ? t("kpi.pending.oldestToday") : t("kpi.pending.oldest", { count: kpis.pending.oldestDays });
    case "upcoming":
      return kpis.upcoming.next
        ? t("kpi.upcoming.next", { name: firstName(kpis.upcoming.next.employeeName), day: formatDay(kpis.upcoming.next.date, locale, { weekday: "short" }) })
        : t("kpi.upcoming.none");
    case "low":
      return kpis.low.lowest
        ? t("kpi.low.lowest", { name: firstName(kpis.low.lowest.employeeName), days: formatDays(kpis.low.lowest.available, locale) })
        : t("kpi.low.none");
  }
}

const VALUE: Record<KpiKey, (k: Kpis) => number> = {
  out: (k) => k.out.count,
  pending: (k) => k.pending.count,
  upcoming: (k) => k.upcoming.count,
  low: (k) => k.low.count,
};

export function KpiRow({ kpis, active, onToggle, loading }: { kpis: Kpis; active: KpiKey | null; onToggle: (key: KpiKey) => void; loading?: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t("kpi.group")}
      className="grid shrink-0 grid-cols-2 gap-2 border-b p-3 md:flex md:overflow-x-auto xl:grid xl:grid-cols-4 xl:overflow-visible"
    >
      {ORDER.map((key) => {
        const on = active === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(key)}
            className={cn(
              "rounded-md border px-3 py-2 text-start hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-accent max-md:min-h-[44px] md:min-w-[200px] md:shrink-0 xl:min-w-0",
              on && "border-accent bg-accent/10",
            )}
          >
            {loading ? (
              <>
                <Skeleton className="h-6 w-10" />
                <Skeleton className="mt-1 h-3 w-24" />
              </>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-kpi font-semibold leading-tight tabular-nums" data-testid={`kpi-value-${key}`}>
                    {VALUE[key](kpis)}
                  </span>
                  <span className="truncate text-table font-medium">{t(`kpi.${key}.label`)}</span>
                </div>
                <div className="truncate text-meta text-muted-foreground">{kpiContext(key, kpis, t, i18n.language)}</div>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
