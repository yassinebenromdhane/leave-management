import { WEEK_PRESETS } from "@leave/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/common/toast/ToastProvider";
import SettingsPage from "./SettingsPage";

const data = {
  company: { name: "Acme", countryCode: "FR", workDays: WEEK_PRESETS.monFri, leaveYearStartMonth: 1, allowNegative: false, negativeLimitDays: 0, defaultSaveStatus: "approved", locale: "fr-FR", teamVisibility: "department" },
  departments: [{ id: "d1", name: "Ops", minStaffing: null, sortOrder: 0, employeeCount: 2, activeEmployeeCount: 2 }],
  leaveTypes: [],
  policies: [],
};
vi.mock("@/common/api/settings", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useSettings: () => ({ isPending: false, isError: false, data }),
}));

const setup = (forceReadOnly: boolean) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <SettingsPage forceReadOnly={forceReadOnly} />
      </ToastProvider>
    </QueryClientProvider>,
  );

describe("Settings read-only under 768 px", () => {
  it("shows the values and the note, but no save, add or delete controls, and disables the inputs", () => {
    setup(true);
    expect(screen.getByText("Edit settings on a larger screen")).toBeTruthy();
    expect((screen.getByDisplayValue("Acme") as HTMLInputElement).closest("fieldset")?.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add department" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
  });

  it("is editable on larger screens: Save appears and the week toggles flip the mask", () => {
    setup(false);
    expect(screen.queryByText("Edit settings on a larger screen")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Save" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Sat", pressed: false }));
    expect(screen.getByRole("button", { name: "Sat", pressed: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mon–Sat" }).className).toContain("border-accent");
  });
});
