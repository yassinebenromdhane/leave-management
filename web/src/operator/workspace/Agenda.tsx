// Mobile agenda (spec 2.4): under 768 px the timeline becomes a list grouped by day.
import { useTranslation } from "react-i18next";
import { LeaveTypeChip } from "@/common/components/LeaveTypeChip";
import { formatDay } from "@/common/lib/format";
import { cn } from "@/lib/utils";
import type { AgendaDay } from "./agendaModel";

export function Agenda({ days, today, onOpenLeave }: { days: AgendaDay[]; today: string; onOpenLeave: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  return (
    <div className="h-full overflow-auto pb-24">
      {days.map((d) => (
        <section key={d.date} aria-label={formatDay(d.date, locale, { weekday: "long", day: "numeric", month: "long" })}>
          <h2 className={cn("sticky top-0 z-10 border-b bg-muted/60 px-3 py-1.5 text-meta font-semibold capitalize backdrop-blur", d.date === today && "text-accent")}>
            {formatDay(d.date, locale, { weekday: "short", day: "numeric", month: "short" })}
            {d.date === today ? <span className="ms-2 font-normal normal-case">{t("agenda.today")}</span> : null}
          </h2>
          <ul>
            {d.items.map(({ leave, half }) => (
              <li key={leave.id} className="border-b">
                <button
                  type="button"
                  onClick={() => onOpenLeave(leave.id)}
                  className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-start focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{leave.employeeName}</span>
                  {half !== "full" ? <span className="rounded border px-1.5 text-meta text-muted-foreground">{t(`halfDay.${half}`)}</span> : null}
                  <LeaveTypeChip name={leave.leaveTypeName} color={leave.color} />
                  {leave.status === "pending" ? (
                    <span className="inline-flex items-center gap-1 text-meta text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-status-pending" aria-hidden="true" />
                      {t("status.pending")}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
