// Spec 4.2 rules 2 and 3. Balances are never stored: they are sums of ledger entries.
//   balance(date)  = Σ ledger_entry.days with effective_date <= date
//   reserved       = Σ working_days of Pending, non-deleted requests (never written to the ledger)
//   available      = balance − reserved
//   taken          = days consumed by approved leave (−Σ of `leave` and `reversal` entries)
import type { EntryType, IsoDate } from "../types";
import { fromHalves, toHalves } from "./halfDays";

export type LedgerLine = { days: number; effectiveDate: IsoDate; entryType: EntryType };
export type PendingLine = { workingDays: number };

export function balanceAt(entries: readonly LedgerLine[], onDate: IsoDate): number {
  let h = 0;
  for (const e of entries) if (e.effectiveDate <= onDate) h += toHalves(e.days);
  return fromHalves(h);
}

export function reservedDays(pending: readonly PendingLine[]): number {
  let h = 0;
  for (const p of pending) h += toHalves(p.workingDays);
  return fromHalves(h);
}

export type BalanceSummary = {
  balance: number;
  taken: number;
  pending: number;
  available: number;
};

export function summarizeBalance(input: {
  entries: readonly LedgerLine[];
  pending: readonly PendingLine[];
  onDate: IsoDate;
}): BalanceSummary {
  const balance = balanceAt(input.entries, input.onDate);
  let takenH = 0;
  for (const e of input.entries) {
    if (e.effectiveDate <= input.onDate && (e.entryType === "leave" || e.entryType === "reversal")) {
      takenH -= toHalves(e.days);
    }
  }
  const pending = reservedDays(input.pending);
  return {
    balance,
    taken: fromHalves(takenH),
    pending,
    available: fromHalves(toHalves(balance) - toHalves(pending)),
  };
}

/** Balance after a leave of `days` would be deducted (the "12 → 7.5" preview). */
export const balanceAfter = (available: number, days: number): number =>
  fromHalves(toHalves(available) - toHalves(days));

export type RunningLine<T> = T & { runningBalance: number };

/** Ledger view: entries ordered by effective date then creation, with the running balance. */
export function withRunningBalance<T extends LedgerLine & { createdAt?: string }>(entries: readonly T[]): RunningLine<T>[] {
  const sorted = [...entries].sort(
    (a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
  );
  let h = 0;
  return sorted.map((e) => {
    h += toHalves(e.days);
    return { ...e, runningBalance: fromHalves(h) };
  });
}
