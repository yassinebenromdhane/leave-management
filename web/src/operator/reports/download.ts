// Download a report through a same-origin anchor; the session cookie is sent by the browser.
import type { ExportFormat } from "@leave/shared";
import { exportUrl, type ReportKind } from "@/common/api/reports";
import { rememberExportFormat } from "./exportFormat";

export function downloadReport(kind: ReportKind, from: string, to: string, format: ExportFormat): void {
  rememberExportFormat(format);
  const a = document.createElement("a");
  a.href = exportUrl(kind, from, to, format);
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
