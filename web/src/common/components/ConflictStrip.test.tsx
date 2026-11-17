import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConflictStrip } from "./ConflictStrip";

const overlap = {
  code: "conflicts.selfOverlap",
  severity: "blocking",
  params: { leaveId: "L9", type: "Paid leave", start: "2026-01-12", end: "2026-01-14" },
};

describe("ConflictStrip", () => {
  it("shows the blocking issue as an alert with a link to the clashing leave", () => {
    const onOpen = vi.fn();
    render(<ConflictStrip blocking={[overlap]} warnings={[]} onOpenLeave={onOpen} />);
    expect(screen.getByRole("alert").textContent).toContain("Overlaps with paid leave 12 to 14 Jan");
    fireEvent.click(screen.getByRole("button", { name: "Open that leave" }));
    expect(onOpen).toHaveBeenCalledWith("L9");
  });

  it("renders warnings without alerts and formats their params", () => {
    render(
      <ConflictStrip
        blocking={[]}
        warnings={[
          {
            code: "conflicts.colleaguesOff",
            severity: "warning",
            params: {
              count: 2,
              size: 5,
              department: "Logistics",
              people: [
                { name: "Sami", start: "2026-01-12", end: "2026-01-16" },
                { name: "Ines", start: "2026-01-14", end: "2026-01-14" },
              ],
            },
          },
          { code: "conflicts.negativeBalance", severity: "warning", params: { exceeds: 1.5, limit: 3 } },
        ]}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    const text = screen.getByTestId("conflict-strip").textContent ?? "";
    expect(text).toContain("2 of 5 in Logistics already off: Sami (12 to 16), Ines (14)");
    expect(text).toContain("Exceeds balance by 1.5 days");
  });

  it("renders nothing when there are no issues", () => {
    const { container } = render(<ConflictStrip blocking={[]} warnings={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
