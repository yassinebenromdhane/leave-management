// "Who's out" (spec 2.1): Today / This week / Next week. Each line: avatar initials, name, type
// chip, return date. 280 px right panel on wide screens, a popover-style panel behind a top-bar
// button below 1280 px. Props only.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LeaveTypeChip } from "@/common/components/LeaveTypeChip";
import { formatDay } from "@/common/lib/format";
import { cn } from "@/lib/utils";
import { WHOS_OUT_TABS, whosOut, type WhosOutTab } from "./agendaModel";
import type { CalendarContext } from "./kpis";
import { initials } from "./Timeline";
import type { LeaveRow } from "@/common/api/leaves";

export function WhosOutPanel({ leaves, ctx, onOpenLeave, className }: { leaves: readonly LeaveRow[]; ctx: CalendarContext; onOpenLeave: (id: string) => void; className?: string }) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<WhosOutTab>("today");
  const lines = whosOut(leaves, tab, ctx);
  return (
    <aside aria-label={t("whosOut.title")} className={cn("flex min-h-0 flex-col bg-background", className)}>
      <div className="flex items-center gap-2 px-4 pt-4">
        <h2 className="text-table font-semibold">{t("whosOut.title")}</h2>
        <span aria-hidden="true" className="rounded-full bg-muted px-2 text-meta font-semibold leading-5 tabular-nums text-muted-foreground">
          {lines.length}
        </span>
      </div>
      <div role="tablist" aria-label={t("whosOut.title")} className="mx-3 mt-3 flex gap-0.5 rounded-lg bg-muted p-0.5">
        {WHOS_OUT_TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`whosout-tab-${k}`}
            aria-selected={tab === k}
            aria-controls="whosout-panel"
            onClick={() => setTab(k)}
            className={cn(
              "h-7 flex-1 truncate rounded-md px-2 text-meta font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent",
              tab === k && "bg-background text-foreground shadow-card",
            )}
          >
            {t(`whosOut.tab.${k}`)}
          </button>
        ))}
      </div>
      <ul id="whosout-panel" role="tabpanel" aria-labelledby={`whosout-tab-${tab}`} className="min-h-0 flex-1 space-y-0.5 overflow-auto p-2 pt-3">
        {lines.length === 0 ? <li className="px-1 py-8 text-center text-meta text-muted-foreground">{t("whosOut.none")}</li> : null}
        {lines.map(({ leave, back }) => (
          <li key={leave.id}>
            <button type="button" onClick={() => onOpenLeave(leave.id)} className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-start transition-colors hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-accent">
              <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
                {initials(leave.employeeName)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{leave.employeeName}</span>
                <span className="block text-meta text-muted-foreground">{t("whosOut.back", { date: formatDay(back, i18n.language, { weekday: "short", day: "numeric" }) })}</span>
              </span>
              <LeaveTypeChip name={leave.leaveTypeName} color={leave.color} className="max-w-[90px]" />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
