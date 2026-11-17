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
      <h2 className="px-3 pt-3 text-table font-semibold">{t("whosOut.title")}</h2>
      <div role="tablist" aria-label={t("whosOut.title")} className="flex gap-1 border-b px-2 pt-2">
        {WHOS_OUT_TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`whosout-tab-${k}`}
            aria-selected={tab === k}
            aria-controls="whosout-panel"
            onClick={() => setTab(k)}
            className={cn("h-8 rounded-t-md border-b-2 border-transparent px-2.5 text-meta text-muted-foreground hover:text-foreground", tab === k && "border-accent font-medium text-foreground")}
          >
            {t(`whosOut.tab.${k}`)}
          </button>
        ))}
      </div>
      <ul id="whosout-panel" role="tabpanel" aria-labelledby={`whosout-tab-${tab}`} className="min-h-0 flex-1 overflow-auto p-2">
        {lines.length === 0 ? <li className="px-1 py-6 text-center text-meta text-muted-foreground">{t("whosOut.none")}</li> : null}
        {lines.map(({ leave, back }) => (
          <li key={leave.id}>
            <button type="button" onClick={() => onOpenLeave(leave.id)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-start hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-accent">
              <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
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
