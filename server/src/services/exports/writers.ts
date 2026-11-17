// XLSX (ExcelJS) and CSV (csv-stringify) writers for a ReportTable (spec 1.6, MVP formats).
// XLSX: frozen bold header, column widths, numbers as numbers (format 0.0), dates as real dates,
// localized sheet name and headers. CSV: UTF-8 BOM; fr locales use ";" and decimal ",",
// others "," and "."; dates as YYYY-MM-DD.
import { stringify } from "csv-stringify/sync";
import ExcelJS from "exceljs";
import { boolLabel, langOf, sheetLabel, valueLabel, type ExportLang } from "./labels";
import type { ReportCell, ReportColumn, ReportTable } from "./table";

const textOf = (lang: ExportLang, col: ReportColumn, v: ReportCell): string => {
  if (v === null || v === undefined) return "";
  if (col.kind === "boolean") return boolLabel(lang, v === true);
  if (col.kind === "enum" && col.dict) return valueLabel(lang, col.dict, String(v));
  return String(v);
};

const WIDTH: Record<ReportColumn["kind"], number> = { text: 18, days: 12, date: 12, enum: 14, boolean: 10 };

export async function toXlsx(table: ReportTable): Promise<Buffer> {
  const lang = langOf(table.locale);
  const wb = new ExcelJS.Workbook();
  wb.created = new Date(0); // deterministic metadata; the period is in the file name
  const ws = wb.addWorksheet(sheetLabel(lang, table.kind), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = table.columns.map((c) => ({
    key: c.key,
    header: c.label,
    width: Math.min(40, Math.max(WIDTH[c.kind], c.label.length + 2)),
    style: c.kind === "days" ? { numFmt: "0.0" } : c.kind === "date" ? { numFmt: lang === "fr" ? "dd/mm/yyyy" : "yyyy-mm-dd" } : {},
  }));
  ws.getRow(1).font = { bold: true };

  for (const r of table.rows) {
    const values: Record<string, ExcelJS.CellValue> = {};
    for (const c of table.columns) {
      const v = r[c.key] ?? null;
      if (v === null) values[c.key] = null;
      else if (c.kind === "days") values[c.key] = Number(v);
      else if (c.kind === "date") values[c.key] = new Date(`${String(v)}T00:00:00Z`); // ExcelJS serializes in UTC
      else values[c.key] = textOf(lang, c, v);
    }
    ws.addRow(values);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toCsv(table: ReportTable): string {
  const lang = langOf(table.locale);
  const delimiter = lang === "fr" ? ";" : ",";
  const decimal = lang === "fr" ? "," : ".";
  const header = table.columns.map((c) => c.label);
  const records = table.rows.map((r) =>
    table.columns.map((c) => {
      const v = r[c.key] ?? null;
      if (c.kind === "days" && v !== null) return Number(v).toFixed(1).replace(".", decimal);
      return textOf(lang, c, v);
    }),
  );
  return stringify([header, ...records], { delimiter, bom: true, record_delimiter: "windows" });
}
