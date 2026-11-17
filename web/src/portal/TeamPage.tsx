// Team (spec 1.7): who is away this week and next. Names and "Away" only: no type colours, no
// notes, no statuses. The data is the server's projection; nothing is derived from richer data.
import { addIsoDays } from "@leave/shared";
import { useTranslation } from "react-i18next";
import { usePortalTeam, type PortalTeam } from "@/common/api/portal";
import { EmptyState } from "@/common/components/EmptyState";
import { todayIso } from "@/common/lib/date";
import { errorMessage } from "@/common/lib/errorMessage";
import { formatDay } from "@/common/lib/format";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/ui/Skeleton";
import { twoWeeks } from "./weeks";

type Away = PortalTeam["people"][number];

/** Which part of `day` the person is away: the whole day, or only the morning / afternoon. */
export function awayPart(p: Away, day: string): "full" | "am" | "pm" {
  if (day === p.startDate && p.startHalf === "pm") return "pm";
  if (day === p.endDate && p.endHalf === "am") return "am";
  return "full";
}

export default function TeamPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const today = todayIso();
  const { from, to } = twoWeeks(today);
  const team = usePortalTeam(from, to);

  if (team.isPending) {
    return (
      <div className="space-y-3" role="status" aria-label={t("common.loading")}>
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  }
  if (team.error || !team.data) {
    return (
      <p role="alert" className="text-status-rejected">
        {errorMessage(t, team.error)}
      </p>
    );
  }
  const people = team.data.people;
  if (people.length === 0) return <EmptyState message={t("portal.team.empty")} />;

  const weeks = [0, 1].map((w) => {
    const start = addIsoDays(from, w * 7);
    const days = Array.from({ length: 7 }, (_, i) => addIsoDays(start, i)).flatMap((day) => {
      const away = people.filter((p) => p.startDate <= day && p.endDate >= day);
      return away.length > 0 ? [{ day, away }] : [];
    });
    return { start, days };
  });

  return (
    <div className="space-y-5">
      {weeks.map((w, i) => {
        const title = t(i === 0 ? "portal.team.thisWeek" : "portal.team.nextWeek");
        return (
          <section key={w.start} className="space-y-2" aria-label={title}>
            <h2 className="font-medium">{title}</h2>
            {w.days.length === 0 ? (
              <p className="text-muted-foreground">{t("portal.team.nobody")}</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {w.days.map(({ day, away }) => (
                  <li key={day} className={cn("flex gap-3 px-3 py-2", day === today && "bg-accent/5")}>
                    <span className="w-20 shrink-0 text-muted-foreground tabular-nums">{formatDay(day, locale, { weekday: "short", day: "numeric" })}</span>
                    <ul className="min-w-0 flex-1 space-y-0.5">
                      {away.map((p) => {
                        const part = awayPart(p, day);
                        return (
                          <li key={p.employeeId + p.startDate} className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium">{p.fullName}</span>
                            <span className="shrink-0 rounded border px-1.5 text-meta text-muted-foreground">
                              {part === "full" ? t("portal.team.away") : `${t("portal.team.away")} · ${t(`halfDay.${part}`)}`}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
