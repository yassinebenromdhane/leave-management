// Day amounts are multiples of 0.5 (CLAUDE.md invariant 7). Inside shared rules they are counted
// as integer HALVES and converted to days only at the edge, so totals never drift.

export type Halves = number;

export const toHalves = (days: number): Halves => {
  const h = days * 2;
  if (!Number.isInteger(h)) throw new Error(`Not a 0.5-day step: ${days}`);
  return h;
};

export const fromHalves = (halves: Halves): number => halves / 2;

export const isHalfStep = (days: number): boolean => Number.isFinite(days) && Number.isInteger(days * 2);

/** Sums day amounts exactly (via halves). */
export const sumDays = (values: Iterable<number>): number => {
  let h = 0;
  for (const v of values) h += toHalves(v);
  return fromHalves(h);
};
