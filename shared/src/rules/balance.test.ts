import { describe, expect, it } from "vitest";
import { balanceAfter, balanceAt, reservedDays, summarizeBalance, withRunningBalance, type LedgerLine } from "./balance";

const ledger: LedgerLine[] = [
  { entryType: "opening", days: 12, effectiveDate: "2026-01-01" },
  { entryType: "accrual", days: 1.5, effectiveDate: "2026-02-01" },
  { entryType: "leave", days: -4.5, effectiveDate: "2026-02-10" },
  { entryType: "reversal", days: 4.5, effectiveDate: "2026-02-10" },
  { entryType: "leave", days: -3, effectiveDate: "2026-03-02" },
  { entryType: "adjustment", days: -0.5, effectiveDate: "2026-03-15" },
];

describe("balanceAt (rule 2)", () => {
  it.each([
    ["2025-12-31", 0],
    ["2026-01-01", 12],
    ["2026-02-01", 13.5],
    ["2026-02-10", 13.5], // leave and its reversal cancel out
    ["2026-03-01", 13.5], // the entry dated the next day is excluded
    ["2026-03-02", 10.5],
    ["2026-12-31", 10],
  ])("on %s = %s", (date, expected) => {
    expect(balanceAt(ledger, date)).toBe(expected);
  });

  it("sums 0.5 steps exactly (no floating drift)", () => {
    const many: LedgerLine[] = Array.from({ length: 1000 }, () => ({ entryType: "accrual", days: 0.5, effectiveDate: "2026-01-01" }));
    expect(balanceAt(many, "2026-01-01")).toBe(500);
  });
});

describe("reserved and available (rule 3)", () => {
  it("reserved is the sum of pending working days", () => {
    expect(reservedDays([{ workingDays: 2 }, { workingDays: 0.5 }])).toBe(2.5);
  });

  it("summarizes balance, taken, pending and available", () => {
    expect(summarizeBalance({ entries: ledger, pending: [{ workingDays: 2 }], onDate: "2026-12-31" })).toEqual({
      balance: 10,
      taken: 3,
      pending: 2,
      available: 8,
    });
  });

  it("previews the balance after a leave", () => {
    expect(balanceAfter(12, 4.5)).toBe(7.5);
    expect(balanceAfter(1, 2.5)).toBe(-1.5);
  });
});

describe("withRunningBalance", () => {
  it("orders by effective date and accumulates", () => {
    const shuffled = [ledger[4]!, ledger[0]!, ledger[2]!, ledger[1]!];
    expect(withRunningBalance(shuffled).map((l) => l.runningBalance)).toEqual([12, 13.5, 9, 6]);
  });
});
