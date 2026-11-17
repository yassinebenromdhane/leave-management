// The server's single notion of "today" for balances and opening entries.
// Choice: the UTC calendar date of the server clock. The app serves one company in one
// country, and the container runs with TZ=UTC; a leave day is a calendar date, so the only
// effect is that "today" flips at 00:00 UTC rather than local midnight. If that ever matters,
// change it here only (e.g. derive the zone from company_settings).
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
