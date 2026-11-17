// On-screen preview of a {columns, rows} report. Cells are formatted by column kind.
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { ReportColumn, ReportData } from "@/common/api/reports";
import { formatDay, formatDays } from "@/common/lib/format";
import { cn } from "@/lib/utils";

const DICT_NAMESPACE: Record<string, string> = { half: "halfDay", status: "status", source: "source" };

/** Text for one cell. days: one decimal only when needed; date: locale; boolean: yes/no; enum: via dict. */
export function formatCell(value: unknown, column: Pick<ReportColumn, "kind" | "dict">, locale: string, t: TFunction): string {
  if (value === null || value === undefined || value === "") return "";
  switch (column.kind) {
    case "days":
      return typeof value === "number" ? formatDays(value, locale) : String(value);
    case "date":
      return typeof value === "string" ? formatDay(value, locale, { day: "numeric", month: "short", year: "numeric" }) : String(value);
    case "boolean":
      return value ? t("common.yes") : t("common.no");
    case "enum": {
      const ns = column.dict ? DICT_NAMESPACE[column.dict as string] : undefined;
      return ns ? t(`${ns}.${String(value)}`, { defaultValue: String(value) }) : String(value);
    }
    default:
      return String(value);
  }
}

export function ReportTable({ report }: { report: ReportData }) {
  const { t, i18n } = useTranslation();
  const rows = report.rows as Array<Record<string, unknown>>;
  if (rows.length === 0) return <p className="px-4 py-8 text-center text-muted-foreground">{t("reports.empty")}</p>;
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-table">
        <thead className="sticky top-0 bg-background text-meta text-muted-foreground shadow-[0_1px_0_var(--border)]">
          <tr>
            {report.columns.map((c) => (
              <th key={c.key} scope="col" className={cn("h-9 whitespace-nowrap px-3 font-medium", c.kind === "days" ? "text-end" : "text-start")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="h-9 border-b">
              {report.columns.map((c) => (
                <td key={c.key} className={cn("whitespace-nowrap px-3", c.kind === "days" && "text-end tabular-nums", c.kind === "date" && "tabular-nums")}>
                  {formatCell(r[c.key], c, i18n.language, t)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
