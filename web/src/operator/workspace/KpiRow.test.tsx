import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, scopeLeaves, toggleKpi, type Filters } from "./filters";
import { leave, TODAY } from "./fixtures";
import { computeKpis, leaveMatchesKpi } from "./kpis";
import { KpiRow } from "./KpiRow";

const leaves = [
  leave({ employeeName: "P One", status: "pending" }),
  leave({ employeeName: "P Two", status: "pending" }),
  leave({ employeeName: "A One", status: "approved" }),
];

/** Minimal wiring of the real helpers, the way WorkspacePage uses them. */
function Harness() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const scoped = scopeLeaves(leaves, filters, "en");
  const kpis = computeKpis({ leaves: scoped, employees: [], leaveTypeId: null, ctx: { today: TODAY, workDays: 31, holidays: [] } });
  const shown = scoped.filter((l) => !filters.kpi || leaveMatchesKpi(l, filters.kpi, TODAY, new Set()));
  return (
    <>
      <KpiRow kpis={kpis} active={filters.kpi} onToggle={(k) => setFilters((f) => toggleKpi(f, k))} />
      <ul aria-label="shown">
        {shown.map((l) => (
          <li key={l.id}>{l.employeeName}</li>
        ))}
      </ul>
      <input aria-label="search" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
    </>
  );
}

describe("KPI cards", () => {
  it("show one number, a label and a context line", () => {
    render(<Harness />);
    expect(screen.getByTestId("kpi-value-pending").textContent).toBe("2");
    expect(screen.getByRole("button", { name: /Pending requests/ })).toBeTruthy();
    expect(screen.getByText("oldest 6 days ago")).toBeTruthy();
  });

  it("clicking Pending filters to the pending leaves; clicking again clears", () => {
    render(<Harness />);
    const card = screen.getByRole("button", { name: /Pending requests/ });
    expect(screen.getAllByRole("listitem")).toHaveLength(3);

    fireEvent.click(card);
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["P One", "P Two"]);

    fireEvent.click(card);
    expect(card.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("filters also apply to the KPI numbers", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("search"), { target: { value: "P One" } });
    expect(screen.getByTestId("kpi-value-pending").textContent).toBe("1");
  });
});
