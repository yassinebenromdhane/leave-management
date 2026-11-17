// Locale-aware formatting. Dates are formatted in UTC from their ISO string so the result never
// depends on the browser's time zone.
/** English uses day-month order (12 Jan), not the US month-day order. */
const intl = (locale: string): string => (locale.startsWith("en") ? "en-GB" : locale);
const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

export function formatDay(
  iso: string,
  locale: string,
  opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
): string {
  return new Intl.DateTimeFormat(intl(locale), { ...opts, timeZone: "UTC" }).format(asDate(iso));
}

/** Day counts show one decimal only when needed: 4.5, 5. */
export function formatDays(n: number, locale: string, signed = false): string {
  return new Intl.NumberFormat(intl(locale), {
    maximumFractionDigits: 1,
    ...(signed ? { signDisplay: "exceptZero" as const } : {}),
  }).format(n);
}

/**
 * "12 to 14 Jan" (withMonth) or "12 to 14" (compact); a single day is "12 Jan" / "12".
 * Ranges across months always carry both months.
 */
export function formatRange(start: string, end: string, locale: string, toWord: string, withMonth = true): string {
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const dayOnly = (d: string) => formatDay(d, locale, { day: "numeric" });
  if (start === end) return withMonth ? formatDay(start, locale) : dayOnly(start);
  if (sameMonth) {
    return withMonth
      ? `${dayOnly(start)} ${toWord} ${formatDay(end, locale)}`
      : `${dayOnly(start)} ${toWord} ${dayOnly(end)}`;
  }
  return `${formatDay(start, locale)} ${toWord} ${formatDay(end, locale)}`;
}
