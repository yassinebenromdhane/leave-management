// KPI cards (spec 2.1 / 2.3): one number, one label, one context line. Each card is a toggle
// filter on the workspace. No charts. Props only.
import type { TFunction } from "i18next";
import { CalendarClock, Clock, TrendingDown, UserX, type LucideIcon } from "lucide-react";
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

/** Soft icon badge per card: the icon repeats the label's meaning, so colour is never the only cue. */
const BADGE: Record<KpiKey, { icon: LucideIcon; tint: string }> = {
  out: { icon: UserX, tint: "bg-accent-soft text-accent" },
  pending: { icon: Clock, tint: "bg-amber-50 text-amber-700" },
  upcoming: { icon: CalendarClock, tint: "bg-sky-50 text-sky-700" },
  low: { icon: TrendingDown, tint: "bg-rose-50 text-rose-700" },
};

export function KpiRow({ kpis, active, onToggle, loading }: { kpis: Kpis; active: KpiKey | null; onToggle: (key: KpiKey) => void; loading?: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t("kpi.group")}
      className="grid shrink-0 grid-cols-2 gap-3 px-3 pt-3 md:flex md:overflow-x-auto md:px-4 md:pt-4 xl:grid xl:grid-cols-4 xl:overflow-visible"
    >
      {ORDER.map((key) => {
        const on = active === key;
        const { icon: Icon, tint } = BADGE[key];
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(key)}
            className={cn(
              "group cursor-pointer rounded-xl border bg-background p-3 text-start shadow-card transition-[border-color,box-shadow,background-color] duration-150 hover:border-slate-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent max-md:min-h-[44px] md:min-w-[210px] md:shrink-0 md:p-4 xl:min-w-0",
              on && "border-accent bg-accent-soft ring-1 ring-accent hover:border-accent",
            )}
          >
            {loading ? (
              <>
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-3 h-6 w-10" />
                <Skeleton className="mt-2 h-3 w-28" />
              </>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-meta font-medium text-muted-foreground">{t(`kpi.${key}.label`)}</span>
                  <span aria-hidden="true" className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg max-md:h-7 max-md:w-7", tint)}>
                    <Icon size={16} strokeWidth={2} />
                  </span>
                </div>
                <span className="-mt-1 block text-kpi font-semibold leading-none tracking-tight tabular-nums md:text-[28px]" data-testid={`kpi-value-${key}`}>
                  {VALUE[key](kpis)}
                </span>
                <div className="mt-2 truncate text-meta text-muted-foreground">{kpiContext(key, kpis, t, i18n.language)}</div>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
