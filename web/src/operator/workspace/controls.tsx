// Small workspace controls: segmented switch, period navigator, department / type / status filters.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useReference } from "@/common/api/reference";
import { formatDay } from "@/common/lib/format";
import { cn } from "@/lib/utils";
import { useOperatorUi } from "../OperatorContext";
import { STATUS_FILTERS, type StatusFilter } from "./filters";
import type { Zoom } from "./timelineModel";

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("inline-flex h-9 items-center rounded-lg bg-muted p-0.5 max-md:h-11", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-8 items-center gap-1 rounded-md px-3 text-meta font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent max-md:h-10",
            value === o.value && "bg-background text-foreground shadow-card",
          )}
        >
          {o.label}
          {o.hint ? <kbd className="text-[10px] text-muted-foreground max-md:hidden">{o.hint}</kbd> : null}
        </button>
      ))}
    </div>
  );
}

export function ZoomSwitch({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { zoom, setZoom } = useOperatorUi();
  return (
    <Segmented<Zoom>
      value={zoom}
      onChange={setZoom}
      label={t("zoom.label")}
      className={className}
      options={[
        { value: "week", label: t("zoom.week"), hint: "W" },
        { value: "month", label: t("zoom.month"), hint: "M" },
      ]}
    />
  );
}

export function periodLabel(period: { from: string; to: string }, zoom: Zoom, locale: string, toWord: string): string {
  if (zoom === "month") return formatDay(period.from, locale, { month: "long", year: "numeric" });
  const sameMonth = period.from.slice(0, 7) === period.to.slice(0, 7);
  const a = formatDay(period.from, locale, sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" });
  return `${a} ${toWord} ${formatDay(period.to, locale, { day: "numeric", month: "short" })}`;
}

export function PeriodNav({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const { period, zoom, shift, goToday } = useOperatorUi();
  const icon = "grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent max-md:h-11 max-md:w-11";
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <button type="button" onClick={() => shift(-1)} aria-label={t("period.previous")} className={icon}>
        <ChevronLeft size={16} aria-hidden="true" className="rtl:rotate-180" />
      </button>
      <button type="button" onClick={goToday} className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-background px-3 text-meta font-medium shadow-card transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-accent max-md:h-11">
        {t("period.today")}
        <kbd className="text-[10px] text-muted-foreground max-md:hidden">T</kbd>
      </button>
      <button type="button" onClick={() => shift(1)} aria-label={t("period.next")} className={icon}>
        <ChevronRight size={16} aria-hidden="true" className="rtl:rotate-180" />
      </button>
      <span aria-live="polite" className="min-w-[7rem] px-1 text-table font-semibold capitalize tabular-nums">
        {periodLabel(period, zoom, i18n.language, t("common.to"))}
      </span>
    </div>
  );
}

const selectClass =
  "h-9 max-w-[11rem] cursor-pointer rounded-lg border bg-background px-2.5 text-meta font-medium shadow-card transition-colors hover:border-slate-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 max-md:h-11 max-md:max-w-none";

export function DepartmentSelect({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { filters, updateFilters } = useOperatorUi();
  const reference = useReference();
  return (
    <select
      aria-label={t("filters.department")}
      value={filters.departmentId ?? ""}
      onChange={(e) => updateFilters({ departmentId: e.target.value || null })}
      className={cn(selectClass, className)}
    >
      <option value="">{t("filters.allDepartments")}</option>
      {(reference.data?.departments ?? []).map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );
}

export function TypeSelect({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { filters, updateFilters } = useOperatorUi();
  const reference = useReference();
  return (
    <select
      aria-label={t("filters.type")}
      value={filters.leaveTypeId ?? ""}
      onChange={(e) => updateFilters({ leaveTypeId: e.target.value || null })}
      className={cn(selectClass, className)}
    >
      <option value="">{t("filters.allTypes")}</option>
      {(reference.data?.leaveTypes ?? []).map((lt) => (
        <option key={lt.id} value={lt.id}>
          {lt.name}
        </option>
      ))}
    </select>
  );
}

export function StatusSelect({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { filters, updateFilters } = useOperatorUi();
  return (
    <select
      aria-label={t("filters.status")}
      value={filters.status}
      onChange={(e) => updateFilters({ status: e.target.value as StatusFilter })}
      className={cn(selectClass, className)}
    >
      {STATUS_FILTERS.map((s) => (
        <option key={s} value={s}>
          {s === "default" ? t("filters.statusDefault") : s === "all" ? t("filters.statusAll") : t(`status.${s}`)}
        </option>
      ))}
    </select>
  );
}
