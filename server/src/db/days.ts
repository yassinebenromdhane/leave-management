// Day amounts are numeric(6,1) in PostgreSQL, which Drizzle returns as strings.
// Convert only through these helpers; never parseFloat inline (CLAUDE.md invariant 7).

/** DB numeric string → number of days (multiple of 0.5). */
export function toDays(value: string | null | undefined): number {
  if (value == null) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n * 2)) {
    throw new Error(`Invalid day amount from database: ${value}`);
  }
  return n;
}

/** Number of days → DB numeric string. Rejects anything that is not a 0.5 step. */
export function fromDays(days: number): string {
  if (!Number.isFinite(days) || !Number.isInteger(days * 2)) {
    throw new Error(`Day amounts must be multiples of 0.5, got ${days}`);
  }
  return days.toFixed(1);
}
