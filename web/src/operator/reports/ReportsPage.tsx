// Reports (spec 1.6): period picker, two report cards with a preview table and XLSX / CSV downloads.
// Reports edit nothing, so they stay usable under 768 px (spec 2.4).
import { EXPORT_FORMATS, type ExportFormat } from "@leave/shared";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useReport, type ReportKind } from "@/common/api/reports";
import { EmptyState } from "@/common/components/EmptyState";
import { todayIso } from "@/common/lib/date";
import { errorMessage } from "@/common/lib/errorMessage";
import { formatDay } from "@/common/lib/format";
import { cn } from "@/lib/utils";
import { SkeletonRows } from "@/ui/Skeleton";
import { downloadReport } from "./download";
import { getExportFormat } from "./exportFormat";
import { initialPeriod, PERIOD_KINDS, periodRange, type PeriodState } from "./period";
import { ReportTable } from "./ReportTable";

const KINDS: Array<{ kind: ReportKind; title: string; hint: string }> = [
  { kind: "payroll", title: "reports.payroll.title", hint: "reports.payroll.hint" },
  { kind: "leave-detail", title: "reports.detail.title", hint: "reports.detail.hint" },
];

function ReportCard({ kind, title, hint, from, to, valid }: { kind: ReportKind; title: string; hint: string; from: string; to: string; valid: boolean }) {
  const { t } = useTranslation();
  const report = useReport(kind, from, to, valid);
  const [last, setLast] = useState<ExportFormat>(getExportFormat);
  const canDownload = valid && report.isSuccess;
  return (
    <section className="rounded-lg border" aria-label={t(title)}>
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">{t(title)}</h2>
          <p className="text-meta text-muted-foreground">{t(hint)}</p>
        </div>
        <div className="flex gap-2">
          {EXPORT_FORMATS.map((f) => (
            <button
              key={f}
              type="button"
              disabled={!canDownload}
              aria-label={t("reports.download", { title: t(title), format: f.toUpperCase() })}
              onClick={() => {
                downloadReport(kind, from, to, f);
                setLast(f);
              }}
              className={cn("inline-flex h-8 items-center gap-1.5 rounded-md border px-3 hover:bg-muted disabled:opacity-50 max-md:h-11", last === f && "border-accent")}
            >
              <Download size={14} aria-hidden="true" />
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </header>
      {!valid ? (
        <p className="px-4 py-8 text-center text-muted-foreground">{t("reports.errors.endBeforeStart")}</p>
      ) : report.isPending ? (
        <SkeletonRows label={t("common.loading")} cols={5} rows={4} />
      ) : report.isError ? (
        <EmptyState message={errorMessage(t, report.error)} actionLabel={t("common.retry")} onAction={() => void report.refetch()} />
      ) : (
        <ReportTable report={report.data} />
      )}
    </section>
  );
}

export default function ReportsPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const [period, setPeriod] = useState<PeriodState>(() => initialPeriod(todayIso()));
  const { from, to } = useMemo(() => periodRange(period), [period]);
  const valid = from !== "" && to !== "" && from <= to;
  const set = (patch: Partial<PeriodState>) => setPeriod((p) => ({ ...p, ...patch }));
  const year = Number(todayIso().slice(0, 4));
  const years = [year - 2, year - 1, year, year + 1];
  const field = "h-8 rounded-md border bg-background px-2 max-md:h-11";
  const long = { day: "numeric", month: "short", year: "numeric" } as const;

  return (
    <section className="flex h-full flex-col">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2">
        <h1 className="text-[15px] font-semibold">{t("nav.reports")}</h1>
        <div role="radiogroup" aria-label={t("reports.period")} className="inline-flex rounded-md border p-0.5">
          {PERIOD_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={period.kind === k}
              onClick={() => set({ kind: k, ...(k === "custom" ? { from, to } : {}) })}
              className={cn("h-7 rounded px-2.5 text-meta max-md:h-9", period.kind === k ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted")}
            >
              {t(`reports.kind.${k}`)}
            </button>
          ))}
        </div>
        {period.kind === "month" ? (
          <select aria-label={t("reports.month")} className={field} value={period.month} onChange={(e) => set({ month: Number(e.target.value) })}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i + 1}>
                {formatDay(`2000-${String(i + 1).padStart(2, "0")}-01`, locale, { month: "long" })}
              </option>
            ))}
          </select>
        ) : null}
        {period.kind === "quarter" ? (
          <select aria-label={t("reports.quarter")} className={field} value={period.quarter} onChange={(e) => set({ quarter: Number(e.target.value) })}>
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>
                {t("reports.quarterN", { n: q })}
              </option>
            ))}
          </select>
        ) : null}
        {period.kind !== "custom" ? (
          <select aria-label={t("reports.year")} className={cn(field, "tabular-nums")} value={period.year} onChange={(e) => set({ year: Number(e.target.value) })}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input type="date" aria-label={t("datePicker.from")} className={cn(field, "tabular-nums")} value={period.from} onChange={(e) => set({ from: e.target.value })} />
            <span className="text-muted-foreground">{t("common.to")}</span>
            <input type="date" aria-label={t("datePicker.to")} className={cn(field, "tabular-nums")} value={period.to} onChange={(e) => set({ to: e.target.value })} />
          </>
        )}
        <span className="text-meta tabular-nums text-muted-foreground">{valid ? `${formatDay(from, locale, long)} – ${formatDay(to, locale, long)}` : ""}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        {KINDS.map((k) => (
          <ReportCard key={k.kind} {...k} from={from} to={to} valid={valid} />
        ))}
      </div>
    </section>
  );
}
