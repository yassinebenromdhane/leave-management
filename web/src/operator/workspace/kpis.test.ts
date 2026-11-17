import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, matchesStatus, mergeLeaves, toggleKpi } from "./filters";
import { employee, leave, TODAY } from "./fixtures";
import { computeKpis, leaveMatchesKpi, nextWorkingDate, returnDate, type CalendarContext } from "./kpis";

const ctx: CalendarContext = { today: TODAY, workDays: 31, holidays: [] };
const base = { employees: [], leaveTypeId: null, ctx };

describe("computeKpis", () => {
  it("Out today counts distinct approved people and the earliest return", () => {
    const k = computeKpis({
      ...base,
      leaves: [
        leave({ employeeId: "a", startDate: "2026-11-13", endDate: "2026-11-16" }), // back Tue 17
        leave({ employeeId: "a", startDate: "2026-11-16", endDate: "2026-11-16" }), // same person
        leave({ employeeId: "b", startDate: "2026-11-16", endDate: "2026-11-16" }), // back Tue 17
        leave({ employeeId: "c", startDate: "2026-11-10", endDate: "2026-11-20" }),
        leave({ employeeId: "d", status: "pending" }), // pending is not "out"
      ],
    });
    expect(k.out).toEqual({ count: 3, backCount: 2, backDate: "2026-11-17" });
  });

  it("returns Monday after a Friday end (weekend skipped)", () => {
    expect(returnDate({ endDate: "2026-11-20", endHalf: "full" }, ctx)).toBe("2026-11-23");
    expect(returnDate({ endDate: "2026-11-20", endHalf: "am" }, ctx)).toBe("2026-11-20");
  });

  it("skips full-day holidays when finding the return date", () => {
    const holidays = [{ date: "2026-11-23", name: "X", isHalfDay: false }];
    expect(nextWorkingDate("2026-11-20", { workDays: 31, holidays })).toBe("2026-11-24");
  });

  it("Pending counts pending leaves and reports the oldest age in days", () => {
    const k = computeKpis({
      ...base,
      leaves: [
        leave({ status: "pending", createdAt: "2026-11-12T08:00:00.000Z" }),
        leave({ status: "pending", submittedAt: "2026-11-14T08:00:00.000Z" }),
        leave({ status: "approved" }),
      ],
    });
    expect(k.pending).toEqual({ count: 2, oldestDays: 4 });
  });

  it("Upcoming counts leaves starting in the next 14 days and names the next one", () => {
    const k = computeKpis({
      ...base,
      leaves: [
        leave({ employeeName: "Late", startDate: "2026-11-30", endDate: "2026-11-30" }), // day 14
        leave({ employeeName: "Soon", startDate: "2026-11-19", endDate: "2026-11-19" }),
        leave({ startDate: "2026-12-01", endDate: "2026-12-01" }), // day 15: out
        leave({ startDate: TODAY }), // today is not upcoming
        leave({ startDate: "2026-11-20", endDate: "2026-11-20", status: "rejected" }),
      ],
    });
    expect(k.upcoming).toEqual({ count: 2, next: { employeeName: "Soon", date: "2026-11-19" } });
  });

  it("Low balances: any deducting type below 2 available, archived ignored, lowest named", () => {
    const k = computeKpis({
      ...base,
      leaves: [],
      employees: [
        employee({ id: "a", fullName: "Ok Person", available: 5 }),
        employee({ id: "b", fullName: "Low Person", available: 1.5 }),
        employee({ id: "c", fullName: "Neg Person", available: -1 }),
        employee({ id: "d", fullName: "Gone Person", available: 0, status: "archived" }),
        employee({ id: "e", fullName: "Edge Person", available: 2 }),
      ],
    });
    expect(k.low).toEqual({ count: 2, lowest: { employeeName: "Neg Person", available: -1 } });
  });

  it("Low balances honours the leave type filter", () => {
    const e = employee({ id: "a" });
    (e.balances as Record<string, unknown>).t2 = { balance: 0, taken: 0, pending: 0, available: 0 };
    expect(computeKpis({ ...base, leaves: [], employees: [e] }).low.count).toBe(1);
    expect(computeKpis({ ...base, leaves: [], employees: [e], leaveTypeId: "t1" }).low.count).toBe(0);
  });
});

describe("KPI filter", () => {
  it("toggleKpi selects, switches and clears", () => {
    const on = toggleKpi(EMPTY_FILTERS, "pending");
    expect(on.kpi).toBe("pending");
    expect(toggleKpi(on, "out").kpi).toBe("out");
    expect(toggleKpi(on, "pending").kpi).toBeNull();
  });

  it("leaveMatchesKpi mirrors the KPI definitions", () => {
    const low = new Set(["e9"]);
    expect(leaveMatchesKpi(leave({ status: "pending" }), "pending", TODAY, low)).toBe(true);
    expect(leaveMatchesKpi(leave({ status: "approved" }), "pending", TODAY, low)).toBe(false);
    expect(leaveMatchesKpi(leave(), "out", TODAY, low)).toBe(true);
    expect(leaveMatchesKpi(leave({ startDate: "2026-11-18", endDate: "2026-11-18" }), "upcoming", TODAY, low)).toBe(true);
    expect(leaveMatchesKpi(leave({ employeeId: "e9" }), "low", TODAY, low)).toBe(true);
  });

  it("status filter default hides rejected and cancelled", () => {
    expect(matchesStatus("rejected", "default")).toBe(false);
    expect(matchesStatus("cancelled", "default")).toBe(false);
    expect(matchesStatus("pending", "default")).toBe(true);
    expect(matchesStatus("rejected", "all")).toBe(true);
    expect(matchesStatus("rejected", "rejected")).toBe(true);
  });

  it("mergeLeaves keeps the first row per id", () => {
    const a = leave({ id: "x", status: "approved" });
    const b = leave({ id: "x", status: "pending" });
    expect(mergeLeaves([a], [b])).toEqual([a]);
  });
});
