import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/common/toast/ToastProvider";
import { AccrualTab, isFutureMonth, policyFromDraft } from "./AccrualTab";

const previewAccrual = vi.hoisted(() => vi.fn());
const runAccrual = vi.hoisted(() => vi.fn());
vi.mock("@/common/api/settings", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  settingsApi: { previewAccrual, runAccrual },
}));

const preview = {
  period: "2026-11",
  rows: [{ employeeId: "e1", employeeName: "Ines Martin", leaveTypeId: "t1", leaveTypeName: "Paid leave", accrualMode: "monthly", periodKey: "2026-11", effectiveDate: "2026-11-30", days: 2.5, alreadyDone: false }],
  totals: { rows: 1, toCreate: 1, alreadyDone: 0, employees: 1, days: 2.5 },
};

function setup(readOnly = false) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <AccrualTab leaveTypes={[]} policies={[]} readOnly={readOnly} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("Run accrual", () => {
  beforeEach(() => {
    previewAccrual.mockReset().mockResolvedValue(preview);
    runAccrual.mockReset().mockResolvedValue({ period: "2026-11", created: 1, skipped: 3, days: 2.5 });
  });

  it("offers no run button until a preview exists, and runs only after the confirmation", async () => {
    setup();
    expect(screen.queryByRole("button", { name: /^Run accrual for/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Ines Martin")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Run accrual for/ }));
    expect(runAccrual).not.toHaveBeenCalled(); // the confirm dialog is open, nothing is written yet
    const dialog = screen.getByRole("dialog");
    const buttons = dialog.querySelectorAll("button");
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(runAccrual).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("1 entries created, 3 already done")).toBeTruthy();
  });

  it("changing the month discards the preview", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText("Ines Martin");
    fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2026-10" } });
    expect(screen.queryByText("Ines Martin")).toBeNull();
  });

  it("future months are refused", () => {
    expect(isFutureMonth("2026-12", "2026-11-16")).toBe(true);
    expect(isFutureMonth("2026-11", "2026-11-16")).toBe(false);
  });

  it("read-only mode hides preview and run", () => {
    setup(true);
    expect(screen.queryByRole("button", { name: "Preview" })).toBeNull();
  });
});

describe("policy draft", () => {
  it("validates half steps and MM-DD", () => {
    const ok = policyFromDraft({ accrualMode: "monthly", rate: "2,5", prorate: true, cap: "5", expiry: "03-31" });
    expect(ok).toMatchObject({ ok: true, input: { rateDays: 2.5, carryoverCapDays: 5, carryoverExpiryMonthDay: "03-31" } });
    expect(policyFromDraft({ accrualMode: "monthly", rate: "2.3", prorate: true, cap: "", expiry: "" })).toMatchObject({ ok: false });
    expect(policyFromDraft({ accrualMode: "annual", rate: "25", prorate: true, cap: "", expiry: "13-01" })).toMatchObject({ ok: false, error: "settings.errors.monthDay" });
  });
});
