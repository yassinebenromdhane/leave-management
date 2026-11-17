import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusPill } from "./StatusPill";

describe("StatusPill", () => {
  it.each([
    ["pending", "Pending", "bg-status-pending"],
    ["approved", "Approved", "bg-status-approved"],
    ["rejected", "Rejected", "bg-status-rejected"],
    ["cancelled", "Cancelled", "bg-status-cancelled"],
  ] as const)("%s renders a dot and a text label", (status, label, dotClass) => {
    render(<StatusPill status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByTestId("status-dot").className).toContain(dotClass);
  });

  it("is a labelled button only when clickable", () => {
    const { rerender } = render(<StatusPill status="pending" />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<StatusPill status="pending" onClick={() => undefined} />);
    expect(screen.getByRole("button", { name: "Status: Pending. Change status" })).toBeTruthy();
  });
});
