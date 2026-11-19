// Timeline (spec 1.4): employees grouped by collapsible department x days. Sticky employee column
// and date header, headcount row per department, bars with solid (approved) / hatched (pending)
// fill, half-width cells for half days, weekend + holiday shading, today line. Props only.
import { paletteHex, type PaletteKey } from "@leave/shared";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { LeaveRow } from "@/common/api/leaves";
import { formatDay, formatRange } from "@/common/lib/format";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/ui/Skeleton";
import type { DepartmentGroup } from "./agendaModel";
import { barGeometry, offCount, weekdayInitial, type DayColumn, type Zoom } from "./timelineModel";

const NAME_COL = 200;
const ROW_H = 32;

/** Approved = solid, pending = hatched, rejected / cancelled = faded + dashed (never hue). */
export function barStyle(color: string, status: LeaveRow["status"]): CSSProperties {
  const hex = paletteHex(color as PaletteKey);
  switch (status) {
    case "approved":
      return { backgroundColor: hex, borderColor: hex, color: "#fff" };
    case "pending":
      return {
        backgroundImage: `repeating-linear-gradient(135deg, ${hex}66 0 4px, ${hex}1f 4px 8px)`,
        borderColor: hex,
        color: "var(--foreground)",
      };
    default:
      return { backgroundColor: `${hex}22`, borderColor: `${hex}88`, borderStyle: "dashed", color: "var(--muted-foreground)" };
  }
}

type Props = {
  groups: DepartmentGroup[];
  columns: DayColumn[];
  from: string;
  to: string;
  zoom: Zoom;
  loading: boolean;
  onOpenLeave: (id: string) => void;
  onCreate: (employeeId: string, date: string) => void;
};

export function Timeline({ groups, columns, from, to, zoom, loading, onOpenLeave, onCreate }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const n = columns.length;
  const colMin = zoom === "week" ? 112 : 30;
  const minWidth = NAME_COL + n * colMin;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayIndex = columns.findIndex((c) => c.isToday);
  const defaultDate = columns[todayIndex]?.date ?? columns[0]?.date ?? from;

  // Bring today into view when the period changes (only when the grid scrolls horizontally).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || todayIndex < 0 || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft = Math.max(0, (todayIndex - 2) * colMin);
  }, [from, to, todayIndex, colMin]);

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rowStyle: CSSProperties = { minWidth };
  const cells = (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
      {columns.map((c) => (
        <div key={c.date} className={cn("border-s border-border/70 first:border-s-0", c.shaded && "bg-muted/70", c.isToday && "bg-accent-soft/70")} />
      ))}
    </div>
  );
  const todayLine =
    todayIndex >= 0 ? (
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-[5] w-0.5 -translate-x-1/2 rounded-full bg-accent/70 rtl:translate-x-1/2" style={{ insetInlineStart: `${((todayIndex + 0.5) / n) * 100}%` }} />
    ) : null;

  return (
    // `isolate`: the sticky header / name column z-indexes stay inside this scroll box, so they can
    // never paint over the rail or drawers (index.css z-index scale).
    <div ref={scrollRef} className="isolate h-full min-h-0 overflow-auto" role="region" aria-label={t("timeline.label")} tabIndex={-1}>
      {/* sticky date header */}
      <div className="sticky top-0 z-20 flex border-b bg-background" style={rowStyle}>
        <div className="sticky start-0 z-30 flex h-12 shrink-0 items-end border-e bg-background px-3 pb-1.5 text-meta font-semibold uppercase tracking-wide text-muted-foreground" style={{ width: NAME_COL }}>
          {t("workspace.col.employee")}
        </div>
        <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {columns.map((c) => (
            <div
              key={c.date}
              title={c.holiday ?? undefined}
              data-today={c.isToday || undefined}
              className={cn(
                "flex h-12 flex-col items-center justify-center gap-0.5 border-s border-border/70 text-meta leading-tight tabular-nums first:border-s-0",
                c.shaded && "bg-muted/70",
                c.isToday && "bg-accent-soft/70 font-semibold text-accent",
              )}
            >
              {zoom === "week" ? (
                <span className={cn("capitalize", c.isToday && "rounded-full bg-accent px-2 py-0.5 text-accent-foreground")}>{formatDay(c.date, locale, { weekday: "short", day: "numeric" })}</span>
              ) : (
                <>
                  <span className={cn("capitalize", c.isToday ? "text-accent" : "text-muted-foreground")}>{weekdayInitial(c.date, locale)}</span>
                  <span className={cn(c.isToday && "grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-accent-foreground")}>{Number(c.date.slice(8, 10))}</span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {loading ? (
        <div role="status" aria-label={t("common.loading")}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex border-b" style={{ ...rowStyle, height: ROW_H }}>
              <div className="sticky start-0 z-10 flex shrink-0 items-center gap-2 border-e bg-background px-3" style={{ width: NAME_COL }}>
                <Skeleton className="h-5 w-5 rounded-full" />
                <Skeleton className="h-3 w-28" />
              </div>
              <div className="relative flex-1">
                <div className="absolute top-1.5 h-5 animate-pulse rounded bg-muted" style={{ insetInlineStart: `${10 + ((i * 17) % 50)}%`, width: "18%" }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        groups.map((g) => {
          const isCollapsed = collapsed.has(g.departmentId);
          const deptLeaves = g.rows.flatMap((r) => r.leaves).filter((l) => l.status === "approved" || l.status === "pending");
          return (
            <div key={g.departmentId} role="rowgroup">
              <div className="flex border-b bg-slate-50" style={{ ...rowStyle, height: 28 }}>
                <div className="sticky start-0 z-10 shrink-0 border-e bg-slate-50" style={{ width: NAME_COL }}>
                  <button
                    type="button"
                    onClick={() => toggle(g.departmentId)}
                    aria-expanded={!isCollapsed}
                    className="flex h-full w-full items-center gap-1.5 px-2 text-start text-meta font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                  >
                    {isCollapsed ? <ChevronRight size={14} aria-hidden="true" className="rtl:rotate-180" /> : <ChevronDown size={14} aria-hidden="true" />}
                    <span className="truncate">{g.name}</span>
                    <span className="font-normal tabular-nums text-muted-foreground">{g.rows.length}</span>
                  </button>
                </div>
                <div className="relative grid flex-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
                  {columns.map((c) => {
                    const off = offCount(c.date, deptLeaves);
                    return (
                      <div key={c.date} className={cn("flex items-center justify-center border-s border-border/70 text-meta tabular-nums first:border-s-0", c.shaded && "bg-muted/70")} title={off ? t("timeline.off", { count: off }) : undefined}>
                        {off > 0 ? (
                          <span aria-label={t("timeline.off", { count: off })} className="rounded-full bg-amber-50 px-1.5 text-[11px] font-semibold leading-4 text-amber-800 ring-1 ring-amber-200">
                            {zoom === "week" ? t("timeline.off", { count: off }) : off}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              {isCollapsed
                ? null
                : g.rows.map(({ employee, leaves }) => (
                    <div key={employee.id} className="flex border-b" style={{ ...rowStyle, height: ROW_H }}>
                      <div className="sticky start-0 z-10 shrink-0 border-e bg-background" style={{ width: NAME_COL }}>
                        <button
                          type="button"
                          onClick={() => onCreate(employee.id, defaultDate)}
                          aria-label={t("timeline.logFor", { name: employee.fullName })}
                          className="flex h-full w-full items-center gap-2 px-3 text-start font-medium transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                        >
                          <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">
                            {initials(employee.fullName)}
                          </span>
                          <span className="truncate">{employee.fullName}</span>
                        </button>
                      </div>
                      <div
                        className="relative flex-1 cursor-cell"
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          if (rect.width === 0) return;
                          const idx = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * n)));
                          onCreate(employee.id, columns[idx]!.date);
                        }}
                      >
                        {cells}
                        {todayLine}
                        {[...leaves].sort(byStatusRank).map((l) => {
                          const geo = barGeometry(l, from, to);
                          if (!geo || l.id.startsWith("tmp-")) return geo ? <TmpBar key={l.id} left={geo.left} width={geo.width} n={n} color={l.color} /> : null;
                          const range = formatRange(l.startDate, l.endDate, locale, t("common.to"));
                          const label = t("timeline.barLabel", { name: l.employeeName, type: l.leaveTypeName, range, status: t(`status.${l.status}`) });
                          return (
                            <button
                              key={l.id}
                              type="button"
                              aria-label={label}
                              title={label}
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenLeave(l.id);
                              }}
                              data-status={l.status}
                              data-left={geo.left}
                              data-width={geo.width}
                              style={{ ...barStyle(l.color, l.status), insetInlineStart: `${(geo.left / n) * 100}%`, width: `${(geo.width / n) * 100}%` }}
                              className={cn(
                                "absolute top-1 z-[6] flex h-6 cursor-pointer items-center gap-1 overflow-hidden border px-2 text-meta font-medium shadow-[0_1px_1px_rgb(15_23_42/0.06)] transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                                geo.clippedStart ? "rounded-s-none border-s-0" : "rounded-s-md",
                                geo.clippedEnd ? "rounded-e-none border-e-0" : "rounded-e-md",
                                (l.status === "rejected" || l.status === "cancelled") && "line-through",
                              )}
                            >
                              <span className="truncate">{l.leaveTypeName}</span>
                              {l.hasWarning ? <AlertTriangle size={11} className="ms-auto shrink-0" aria-hidden="true" /> : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
            </div>
          );
        })
      )}
    </div>
  );
}

function TmpBar({ left, width, n, color }: { left: number; width: number; n: number; color: string }) {
  return (
    <div
      aria-hidden="true"
      className="absolute top-1 z-[6] h-6 animate-pulse rounded border"
      style={{ insetInlineStart: `${(left / n) * 100}%`, width: `${(width / n) * 100}%`, backgroundColor: `${paletteHex(color as PaletteKey)}55`, borderColor: paletteHex(color as PaletteKey) }}
    />
  );
}

const RANK: Record<LeaveRow["status"], number> = { rejected: 0, cancelled: 0, pending: 1, approved: 2 };
const byStatusRank = (a: LeaveRow, b: LeaveRow) => RANK[a.status] - RANK[b.status];

export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]![0], parts[parts.length - 1]![0]] : [parts[0]?.slice(0, 2)];
  return letters.join("").toLocaleUpperCase();
}
