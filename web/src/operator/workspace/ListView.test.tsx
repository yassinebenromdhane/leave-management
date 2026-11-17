import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/common/toast/ToastProvider";
import { leave } from "./fixtures";
import { ListView } from "./ListView";

const bulkApprove = vi.hoisted(() => vi.fn());
const setStatus = vi.hoisted(() => vi.fn());
vi.mock("@/common/api/leaves", () => ({ leaveApi: { bulkApprove, setStatus } }));

const rows = [
  leave({ id: "p1", employeeName: "Ines Martin", status: "pending" }),
  leave({ id: "p2", employeeName: "Omar Diaz", status: "pending" }),
  leave({ id: "a1", employeeName: "Lea Roy", status: "approved" }),
];

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ToastProvider>
          <ListView rows={rows} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("bulk approve", () => {
  beforeEach(() => bulkApprove.mockReset());

  it("only pending rows can be selected and the button shows the count", () => {
    setup();
    expect(screen.queryByLabelText("Select Lea Roy's leave")).toBeNull();
    expect(screen.queryByRole("button", { name: /Approve selected/ })).toBeNull();
    fireEvent.click(screen.getByLabelText("Select Ines Martin's leave"));
    expect(screen.getByRole("button", { name: "Approve selected (1)" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Select all pending leaves"));
    expect(screen.getByRole("button", { name: "Approve selected (2)" })).toBeTruthy();
  });

  it("sends the selected ids and reports each failure in its own toast", async () => {
    bulkApprove.mockResolvedValue({
      results: [
        { id: "p1", ok: true },
        { id: "p2", ok: false, code: "leave.errors.invalidTransition" },
      ],
    });
    setup();
    fireEvent.click(screen.getByLabelText("Select all pending leaves"));
    fireEvent.click(screen.getByRole("button", { name: "Approve selected (2)" }));

    await waitFor(() => expect(bulkApprove).toHaveBeenCalledWith(["p1", "p2"]));
    expect(await screen.findByText("1 leave approved")).toBeTruthy();
    expect(await screen.findByText("Omar Diaz: An approved leave cannot go back to pending.")).toBeTruthy();
  });

  it("Undo sets every approved id back to pending through the status endpoint", async () => {
    setStatus.mockReset();
    setStatus.mockResolvedValue({});
    bulkApprove.mockResolvedValue({ results: [{ id: "p1", ok: true }, { id: "p2", ok: true }] });
    setup();
    fireEvent.click(screen.getByLabelText("Select all pending leaves"));
    fireEvent.click(screen.getByRole("button", { name: "Approve selected (2)" }));
    expect(await screen.findByText("2 leaves approved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledTimes(2));
    expect(setStatus).toHaveBeenCalledWith("p1", "pending");
    expect(setStatus).toHaveBeenCalledWith("p2", "pending");
    expect(await screen.findByText("2 leaves back to pending")).toBeTruthy();
  });
});
