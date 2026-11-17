import { describe, expect, it } from "vitest";
import { buildGroups, fetchRange, groupByDay, halfOnDate, tabRange, whosOut } from "./agendaModel";
import { employee, leave, TODAY } from "./fixtures";
import type { CalendarContext } from "./kpis";

const ctx: CalendarContext = { today: TODAY, workDays: 31, holidays: [{ date: "2026-11-18", name: "Holiday", isHalfDay: false }] };

describe("groupByDay (agenda)", () => {
  it("groups by day, skips weekends and holidays, sorts people by name", () => {
    const days = groupByDay(
      [
        leave({ employeeName: "Zoe", startDate: "2026-11-16", endDate: "2026-11-23" }),
        leave({ employeeName: "Ana", startDate: "2026-11-17", endDate: "2026-11-17", startHalf: "am", endHalf: "am" }),
      ],
      "2026-11-16",
      "2026-11-23",
      ctx,
    );
    expect(days.map((d) => d.date)).toEqual(["2026-11-16", "2026-11-17", "2026-11-19", "2026-11-20", "2026-11-23"]);
    expect(days[1]!.items.map((i) => [i.leave.employeeName, i.half])).toEqual([
      ["Ana", "am"],
      ["Zoe", "full"],
    ]);
  });

  it("halfOnDate marks pm start and am end only on the edge days", () => {
    const l = { startDate: "2026-11-16", endDate: "2026-11-18", startHalf: "pm", endHalf: "am" } as const;
    expect(halfOnDate(l, "2026-11-16")).toBe("pm");
    expect(halfOnDate(l, "2026-11-17")).toBe("full");
    expect(halfOnDate(l, "2026-11-18")).toBe("am");
  });
});

describe("whos out", () => {
  const leaves = [
    leave({ employeeName: "Today", startDate: TODAY, endDate: "2026-11-20" }),
    leave({ employeeName: "NextWeek", startDate: "2026-11-24", endDate: "2026-11-24" }),
    leave({ employeeName: "Pending", status: "pending" }),
  ];
  it("tab windows", () => {
    expect(tabRange("today", TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(tabRange("week", "2026-11-18")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(tabRange("next", TODAY)).toEqual({ from: "2026-11-23", to: "2026-11-29" });
  });
  it("lists approved leaves per tab with the return date", () => {
    const today = whosOut(leaves, "today", ctx);
    expect(today.map((x) => x.leave.employeeName)).toEqual(["Today"]);
    expect(today[0]!.back).toBe("2026-11-23"); // Friday end -> Monday
    expect(whosOut(leaves, "next", ctx).map((x) => x.leave.employeeName)).toEqual(["NextWeek"]);
  });
});

describe("fetch range and groups", () => {
  it("union covers the period, this week and the next 14 days", () => {
    expect(fetchRange({ from: "2026-12-01", to: "2026-12-31" }, TODAY)).toEqual({ from: "2026-11-16", to: "2026-12-31" });
    expect(fetchRange({ from: "2026-11-01", to: "2026-11-30" }, TODAY)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(fetchRange({ from: "2026-11-16", to: "2026-11-22" }, TODAY)).toEqual({ from: "2026-11-16", to: "2026-11-30" });
  });
  it("groups employees by department in reference order and can require leaves", () => {
    const emps = [
      employee({ id: "a", fullName: "A", departmentId: "d2", departmentName: "Ops" }),
      employee({ id: "b", fullName: "B", departmentId: "d1", departmentName: "Sales" }),
    ];
    const l = [leave({ employeeId: "a" })];
    const all = buildGroups(emps, l, [{ id: "d1" }, { id: "d2" }], { requireLeaves: false });
    expect(all.map((g) => g.name)).toEqual(["Sales", "Ops"]);
    const only = buildGroups(emps, l, [{ id: "d1" }, { id: "d2" }], { requireLeaves: true });
    expect(only.map((g) => g.name)).toEqual(["Ops"]);
  });
});
