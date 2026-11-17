// The tabular model shared by the on-screen preview (JSON) and the XLSX / CSV writers.
import type { ValueDict } from "./labels";

/** text: as is; days: number (0.5 steps); date: YYYY-MM-DD; enum: translated via a value dictionary; boolean: yes/no. */
export type ColumnKind = "text" | "days" | "date" | "enum" | "boolean";

export type ReportColumn = { key: string; label: string; kind: ColumnKind; dict?: ValueDict };
export type ReportCell = string | number | boolean | null;
export type ReportRow = Record<string, ReportCell>;

export type ReportTable = {
  kind: "payroll" | "leaveDetail";
  period: { from: string; to: string };
  locale: string;
  columns: ReportColumn[];
  rows: ReportRow[];
};
