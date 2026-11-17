import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadReport } from "./download";
import { getExportFormat } from "./exportFormat";

describe("last-used export format", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("defaults to xlsx, remembers csv after a download, ignores junk", () => {
    expect(getExportFormat()).toBe("xlsx");
    downloadReport("payroll", "2026-11-01", "2026-11-30", "csv");
    expect(getExportFormat()).toBe("csv");
    localStorage.setItem("leave.exportFormat", "pdf");
    expect(getExportFormat()).toBe("xlsx");
  });

  it("points the link at the typed export route with the period and format", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    let href = "";
    click.mockImplementation(function (this: HTMLAnchorElement) {
      href = this.getAttribute("href") ?? "";
    });
    downloadReport("leave-detail", "2026-11-01", "2026-11-30", "xlsx");
    expect(href).toBe("/api/operator/reports/leave-detail/export?from=2026-11-01&to=2026-11-30&format=xlsx");
  });
});
