// Report period picker model: Month / Quarter / Year / Custom -> inclusive from/to ISO dates.
import { monthBounds } from "@/common/lib/date";

export type PeriodKind = "month" | "quarter" | "year" | "custom";
export const PERIOD_KINDS: readonly PeriodKind[] = ["month", "quarter", "year", "custom"];

export type PeriodState = {
  kind: PeriodKind;
  year: number;
  month: number; // 1-12
  quarter: number; // 1-4
  from: string;
  to: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

export function initialPeriod(today: string): PeriodState {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const { from, to } = monthBounds(today);
  return { kind: "month", year, month, quarter: Math.ceil(month / 3), from, to };
}

export function periodRange(p: PeriodState): { from: string; to: string } {
  switch (p.kind) {
    case "month":
      return monthBounds(`${p.year}-${pad(p.month)}-01`);
    case "quarter": {
      const first = (p.quarter - 1) * 3 + 1;
      return { from: `${p.year}-${pad(first)}-01`, to: monthBounds(`${p.year}-${pad(first + 2)}-01`).to };
    }
    case "year":
      return { from: `${p.year}-01-01`, to: `${p.year}-12-31` };
    case "custom":
      return { from: p.from, to: p.to };
  }
}
