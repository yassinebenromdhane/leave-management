import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { formatDays } from "@/common/lib/format";

export type DaysCount = { days: number; weekendDays: number; holidayDays: number };

/** "4.5 working days (1 weekend, 1 public holiday excluded)". Pure so it can be tested. */
export function daysCountedText(t: TFunction, r: DaysCount, locale: string): string {
  const base = t("leave.daysCounted", { count: r.days, formatted: formatDays(r.days, locale) });
  const parts: string[] = [];
  if (r.weekendDays > 0) parts.push(t("leave.excludedWeekend", { count: r.weekendDays }));
  if (r.holidayDays > 0) parts.push(t("leave.excludedHoliday", { count: r.holidayDays }));
  return parts.length > 0 ? `${base} ${t("leave.excluded", { parts: parts.join(", ") })}` : base;
}

export function DaysCountedLine({ count }: { count: DaysCount | null }) {
  const { t, i18n } = useTranslation();
  if (!count) return <p className="text-muted-foreground">{t("leave.pickDates")}</p>;
  return (
    <p className="font-medium tabular-nums" aria-live="polite" data-testid="days-counted">
      {daysCountedText(t, count, i18n.language)}
    </p>
  );
}
