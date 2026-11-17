import { render, screen } from "@testing-library/react";
import i18n from "i18next";
import { describe, expect, it } from "vitest";
import type { ReportData } from "@/common/api/reports";
import { formatCell, ReportTable } from "./ReportTable";

const t = i18n.t.bind(i18n);

describe("report cell formatting by column kind", () => {
  it("days: one decimal only when needed", () => {
    expect(formatCell(5, { kind: "days" }, "en", t)).toBe("5");
    expect(formatCell(4.5, { kind: "days" }, "en", t)).toBe("4.5");
  });
  it("date: locale format", () => {
    expect(formatCell("2026-11-16", { kind: "date" }, "en", t)).toBe("16 Nov 2026");
    expect(formatCell("2026-11-16", { kind: "date" }, "fr", t)).toBe("16 nov. 2026");
  });
  it("boolean: yes / no", () => {
    expect(formatCell(true, { kind: "boolean" }, "en", t)).toBe("Yes");
    expect(formatCell(false, { kind: "boolean" }, "en", t)).toBe("No");
  });
  it("enum: via its dictionary", () => {
    expect(formatCell("am", { kind: "enum", dict: "half" }, "en", t)).toBe("Morning");
    expect(formatCell("approved", { kind: "enum", dict: "status" }, "en", t)).toBe("Approved");
  });
  it("empty values render nothing", () => {
    expect(formatCell(null, { kind: "text" }, "en", t)).toBe("");
  });
});

describe("ReportTable", () => {
  const base = { kind: "payroll", period: { from: "2026-11-01", to: "2026-11-30" }, locale: "en-GB" } as unknown as ReportData;
  it("shows the empty message when there are no rows", () => {
    render(<ReportTable report={{ ...base, columns: [], rows: [] } as unknown as ReportData} />);
    expect(screen.getByText("No data for this period")).toBeTruthy();
  });
  it("renders headers and formatted cells", () => {
    const report = {
      ...base,
      columns: [{ key: "name", label: "Name", kind: "text" }, { key: "days", label: "Days", kind: "days" }],
      rows: [{ name: "Ines Martin", days: 2.5 }],
    } as unknown as ReportData;
    render(<ReportTable report={report} />);
    expect(screen.getByText("Ines Martin")).toBeTruthy();
    expect(screen.getByText("2.5").className).toContain("tabular-nums");
  });
});
