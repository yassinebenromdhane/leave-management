import { addIsoDays, isoWeekday } from "@leave/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/common/api/http";
import { queryKeys } from "@/common/api/keys";
import { portalApi } from "@/common/api/portal";
import { todayIso } from "@/common/lib/date";
import { PAID, dashboard, leaveRow, makeClient, reference, renderPortal } from "@/test/portalFixtures";
import { TabBar } from "./components/TabBar";
import HomePage from "./HomePage";
import MyLeavesPage from "./MyLeavesPage";
import PortalShell from "./PortalShell";
import TeamPage from "./TeamPage";
import { twoWeeks } from "./weeks";

const pending = leaveRow({ id: "p1", status: "pending" });
const approved = leaveRow({ id: "a1", status: "approved", startDate: "2026-12-14", endDate: "2026-12-15", addedByHr: true });
const rejected = leaveRow({ id: "r1", status: "rejected", rejectReason: "Busy week", startDate: "2026-11-02", endDate: "2026-11-03" });

function seeded(dash = dashboard({ pending: [pending], upcoming: [approved] }), leaves = [pending, approved, rejected]) {
  const qc = makeClient();
  qc.setQueryData(queryKeys.portalDashboard, dash);
  qc.setQueryData(queryKeys.portalLeaves, leaves);
  qc.setQueryData(queryKeys.portalReference, reference);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("Home", () => {
  it("offers Withdraw only on pending requests", () => {
    renderPortal(<HomePage />, seeded());
    const cards = screen.getAllByTestId("leave-card");
    expect(cards).toHaveLength(2);
    const withdraw = screen.getAllByRole("button", { name: "Withdraw" });
    expect(withdraw).toHaveLength(1);
    expect(within(cards[0]!).getByRole("button", { name: "Withdraw" })).toBeTruthy();
    expect(within(cards[1]!).queryByRole("button", { name: "Withdraw" })).toBeNull();
    expect(within(cards[1]!).getByText("Added by HR")).toBeTruthy(); // marker on the HR-added leave
  });

  it("Withdraw acts at once (no confirmation) and its Undo asks the server to restore the request", async () => {
    const withdraw = vi.spyOn(portalApi, "withdraw").mockResolvedValue({ ...pending, status: "cancelled" } as never);
    const restore = vi.spyOn(portalApi, "restore").mockResolvedValue(pending as never);
    renderPortal(<HomePage />, seeded());

    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith("p1"));
    expect(await screen.findByText("Request withdrawn")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith("p1"));
    expect(await screen.findByText("Request sent to HR again")).toBeTruthy();
  });

  it("Undo too late shows the server's reason", async () => {
    vi.spyOn(portalApi, "withdraw").mockResolvedValue({ ...pending, status: "cancelled" } as never);
    vi.spyOn(portalApi, "restore").mockRejectedValue(new ApiError("portal.errors.undoExpired", 409));
    renderPortal(<HomePage />, seeded());
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Too late to undo. Send a new request instead.")).toBeTruthy();
  });

  it("shows the balance card with available as the main figure", () => {
    renderPortal(<HomePage />, seeded());
    expect(screen.getByText("8 taken · 2 pending")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Paid leave: see balance history/ }).textContent).toContain("10");
  });

  it("dismissing the decision banner calls the read endpoint", async () => {
    const read = vi.spyOn(portalApi, "markRead").mockResolvedValue({ ok: true } as never);
    const decision = {
      notificationId: "n1",
      kind: "rejected",
      createdAt: "2026-11-16T10:00:00Z",
      leave: { id: "r1", leaveTypeName: "Paid leave", color: "blue", startDate: "2026-11-02", endDate: "2026-11-03", startHalf: "full", endHalf: "full", workingDays: 2, status: "rejected", rejectReason: "Busy week" },
    };
    renderPortal(<HomePage />, seeded(dashboard({ pending: [pending], decision } as never)));
    expect(screen.getByText(/was not approved/)).toBeTruthy();
    expect(screen.getByText(/Busy week/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(read).toHaveBeenCalledWith("n1"));
    expect(screen.queryByText(/was not approved/)).toBeNull();
  });

  it("first login shows the live paid balance in the empty state", () => {
    renderPortal(<HomePage />, seeded(dashboard({ balances: [{ leaveTypeId: PAID.id, name: "Paid leave", color: "blue", balance: 18, taken: 0, pending: 0, available: 18 }] } as never), []));
    expect(screen.getByText("You have 18 days of paid leave. Tap Request leave to plan your first one.")).toBeTruthy();
  });
});

describe("My leaves", () => {
  it("groups by year, withdraws only pending and hints at HR for approved", () => {
    renderPortal(<MyLeavesPage />, seeded());
    expect(screen.getByRole("region", { name: "2026" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Withdraw" })).toHaveLength(1);
    expect(screen.getByText("To change an approved leave, contact HR.")).toBeTruthy();
    expect(screen.getByText(/Rejected: Busy week/)).toBeTruthy();
  });
});

describe("Team", () => {
  const monday = twoWeeks(todayIso()).from;
  const away = (over = {}) => ({ employeeId: "e2", fullName: "Sami Benali", startDate: monday, endDate: addIsoDays(monday, 1), startHalf: "full", endHalf: "full", ...over });
  const { from, to } = twoWeeks(todayIso());

  it("shows names and Away only: no type, status or notes", () => {
    const qc = makeClient();
    qc.setQueryData(queryKeys.portalTeam(from, to), { scope: "department", people: [away()] });
    renderPortal(<TeamPage />, qc);
    expect(screen.getAllByText("Sami Benali").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Away").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("status-dot")).toBeNull();
    expect(screen.queryByText(/Approved|Pending|Paid leave|Sick/)).toBeNull();
  });

  it("the tab bar drops Team when the scope is off", () => {
    renderPortal(<TabBar teamVisible={false} />);
    expect(screen.queryByRole("link", { name: "Team" })).toBeNull();
    expect(screen.getByRole("link", { name: "My leaves" })).toBeTruthy();
  });

  it("the shell hides the Team tab for scope off and shows it otherwise", () => {
    for (const [scope, visible] of [["off", false], ["department", true]] as const) {
      const qc = seeded();
      qc.setQueryData(queryKeys.session, { name: "Ines Martin", role: "employee", mustChangePassword: false });
      qc.setQueryData(queryKeys.portalTeam(from, to), { scope, people: [] });
      const { unmount } = renderPortal(<PortalShell />, qc);
      expect(screen.queryByRole("link", { name: "Team" }) !== null).toBe(visible);
      expect(screen.getByRole("link", { name: "Home" })).toBeTruthy();
      unmount();
    }
  });

  it("weekday helper sanity", () => {
    expect(isoWeekday(monday)).toBe(1);
  });
});
