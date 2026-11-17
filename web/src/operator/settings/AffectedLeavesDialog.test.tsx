import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/common/toast/ToastProvider";
import { AffectedLeavesDialog } from "./AffectedLeavesDialog";

const recalculate = vi.hoisted(() => vi.fn());
vi.mock("@/common/api/settings", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  settingsApi: { recalculate },
}));

const leaves = [
  { id: "l1", employeeId: "e1", employeeName: "Ines Martin", leaveTypeName: "Paid leave", startDate: "2026-12-24", endDate: "2026-12-28", status: "approved" as const, oldDays: 3, newDays: 2 },
  { id: "l2", employeeId: "e2", employeeName: "Omar Diaz", leaveTypeName: "Paid leave", startDate: "2026-12-25", endDate: "2026-12-25", status: "pending" as const, oldDays: 1, newDays: 0 },
];

function setup() {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <AffectedLeavesDialog leaves={leaves} onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return onClose;
}

describe("affected leaves dialog", () => {
  beforeEach(() => recalculate.mockReset());

  it("lists each leave with old and new days", () => {
    setup();
    expect(screen.getByText("2 leaves affected")).toBeTruthy();
    expect(screen.getByText("3 → 2")).toBeTruthy();
    expect(screen.getByText("1 → 0")).toBeTruthy();
  });

  it("recalculates with the listed ids and reports skipped leaves with their reason", async () => {
    recalculate.mockResolvedValue({ updated: 1, unchanged: 0, skipped: [{ id: "l2", code: "conflicts.zeroDays" }] });
    const onClose = setup();
    fireEvent.click(screen.getByRole("button", { name: "Recalculate these leaves" }));
    await waitFor(() => expect(recalculate).toHaveBeenCalledWith(["l1", "l2"]));
    expect(await screen.findByText("Skipped: No working days in this range.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled(); // stays open so the reason can be read
  });

  it("Not now closes without calling the server", () => {
    const onClose = setup();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onClose).toHaveBeenCalled();
    expect(recalculate).not.toHaveBeenCalled();
  });
});
