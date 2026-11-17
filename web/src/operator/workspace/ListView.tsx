// List view (spec 1.4): sortable table of the leaves in the period, row selection with bulk
// approve for pending rows, A / R on the selected row.
import { AlertTriangle, ArrowDown, ArrowUp, Paperclip } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { LeaveRow } from "@/common/api/leaves";
import { LeaveTypeChip } from "@/common/components/LeaveTypeChip";
import { isTypingTarget } from "@/common/hooks/useShortcuts";
import { formatDays, formatRange } from "@/common/lib/format";
import { cn } from "@/lib/utils";
import { StatusMenu } from "../StatusMenu";
import { useDrawerNav } from "../useDrawerNav";
import { useLeaveActions } from "../useLeaveActions";

export type SortKey = "employee" | "type" | "start" | "days" | "status" | "source";

export const compare: Record<SortKey, (a: LeaveRow, b: LeaveRow) => number> = {
  employee: (a, b) => a.employeeName.localeCompare(b.employeeName),
  type: (a, b) => a.leaveTypeName.localeCompare(b.leaveTypeName),
  start: (a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate),
  days: (a, b) => a.workingDays - b.workingDays,
  status: (a, b) => a.status.localeCompare(b.status),
  source: (a, b) => a.source.localeCompare(b.source),
};

const isReal = (r: Pick<LeaveRow, "id">) => !r.id.startsWith("tmp-");

export function ListView({ rows }: { rows: LeaveRow[] }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const nav = useDrawerNav();
  const actions = useLeaveActions();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "start", dir: 1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(() => [...rows].sort((a, b) => compare[sort.key](a, b) * sort.dir), [rows, sort]);
  const pendingRows = sorted.filter((r) => r.status === "pending" && isReal(r));
  // Selection survives refetches but never refers to a row that is gone or no longer pending.
  const checkedRows = pendingRows.filter((r) => checked.has(r.id));
  const allChecked = pendingRows.length > 0 && checkedRows.length === pendingRows.length;
  const selected = sorted.find((r) => r.id === selectedId) ?? null;

  const move = (delta: number) => {
    if (sorted.length === 0) return;
    const i = selected ? sorted.indexOf(selected) : -1;
    const next = sorted[Math.min(sorted.length - 1, Math.max(0, i + delta))]!;
    setSelectedId(next.id);
    document.querySelector<HTMLElement>(`[data-row="${next.id}"]`)?.focus();
  };

  // Row-level keys: only while focus is inside the table, so they are inert behind an open drawer.
  const onKeyDown = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement) return; // checkboxes keep Space / arrows
    const key = e.key.toLowerCase();
    if (key === "a" && selected) void actions.setStatus(selected, "approved");
    else if (key === "r" && selected) void actions.setStatus(selected, "rejected");
    else if (key === "arrowdown") move(1);
    else if (key === "arrowup") move(-1);
    else return;
    e.preventDefault();
  };

  const approveSelected = async () => {
    setBusy(true);
    try {
      await actions.bulkApprove(checkedRows);
      setChecked(new Set());
    } finally {
      setBusy(false);
    }
  };

  const toggleOne = (id: string) =>
    setChecked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const th = (key: SortKey, label: string, className?: string) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={cn("h-9 px-3 text-start font-medium", className)}>
      <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        {sort.key === key ? sort.dir === 1 ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" /> : null}
      </button>
    </th>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      {checkedRows.length > 0 ? (
        <div className="flex h-11 shrink-0 items-center gap-3 border-b bg-accent/5 px-3">
          <button
            type="button"
            onClick={() => void approveSelected()}
            disabled={busy}
            className="h-8 rounded-md bg-accent px-3 font-medium text-accent-foreground disabled:opacity-60 max-md:h-11"
          >
            {t("list.approveSelected", { count: checkedRows.length })}
          </button>
          <button type="button" onClick={() => setChecked(new Set())} className="h-8 rounded-md px-2 text-muted-foreground hover:bg-muted max-md:h-11">
            {t("list.clearSelection")}
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[760px] text-table">
          <thead className="sticky top-0 z-10 bg-background text-meta text-muted-foreground shadow-[0_1px_0_var(--border)]">
            <tr>
              <th scope="col" className="h-9 w-10 ps-3 text-start">
                <input
                  type="checkbox"
                  checked={allChecked}
                  disabled={pendingRows.length === 0}
                  onChange={() => setChecked(allChecked ? new Set() : new Set(pendingRows.map((r) => r.id)))}
                  aria-label={t("list.selectAllPending")}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
              </th>
              {th("employee", t("workspace.col.employee"))}
              {th("type", t("workspace.col.type"))}
              {th("start", t("workspace.col.dates"))}
              {th("days", t("workspace.col.days"), "text-end")}
              {th("status", t("workspace.col.status"))}
              <th scope="col" className="h-9 w-16 px-3 text-start font-medium">
                <span className="sr-only">{t("workspace.col.flags")}</span>
              </th>
              {th("source", t("workspace.col.source"))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={r.id}
                data-row={r.id}
                tabIndex={0}
                aria-selected={r.id === selectedId}
                onClick={() => {
                  setSelectedId(r.id);
                  if (isReal(r)) nav.open(`/leave/${r.id}`);
                }}
                onFocus={() => setSelectedId(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.target === e.currentTarget && isReal(r)) nav.open(`/leave/${r.id}`);
                }}
                className={cn(
                  "h-9 cursor-pointer border-b hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                  r.id === selectedId && "bg-accent/10",
                  !isReal(r) && "opacity-60",
                )}
              >
                <td className="ps-3" onClick={(e) => e.stopPropagation()}>
                  {r.status === "pending" && isReal(r) ? (
                    <input
                      type="checkbox"
                      checked={checked.has(r.id)}
                      onChange={() => toggleOne(r.id)}
                      aria-label={t("list.selectRow", { name: r.employeeName })}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                  ) : null}
                </td>
                <td className="px-3 font-medium">{r.employeeName}</td>
                <td className="px-3">
                  <LeaveTypeChip name={r.leaveTypeName} color={r.color} />
                </td>
                <td className="px-3 tabular-nums">{formatRange(r.startDate, r.endDate, locale, t("common.to"))}</td>
                <td className="px-3 text-end tabular-nums">{formatDays(r.workingDays, locale)}</td>
                <td className="px-3" onClick={(e) => e.stopPropagation()}>
                  <StatusMenu status={r.status} onChange={(to) => void actions.setStatus(r, to)} />
                </td>
                <td className="px-3">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    {r.hasWarning ? <AlertTriangle size={14} className="text-status-pending" aria-label={t("leave.hasWarning")} /> : null}
                    {r.attachmentCount > 0 ? <Paperclip size={14} aria-label={t("attachments.has")} /> : null}
                  </span>
                </td>
                <td className="px-3 text-meta text-muted-foreground">{t(`source.${r.source}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
