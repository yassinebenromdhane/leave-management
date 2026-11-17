// Report previews (JSON) and download URLs (same-origin links; the session cookie goes along).
import type { ExportFormat } from "@leave/shared";
import { useQuery } from "@tanstack/react-query";
import { api, apiForUrls } from "./client";
import { unwrap } from "./http";
import { queryKeys } from "./keys";

export type ReportKind = "payroll" | "leave-detail";

const op = api.api.operator.reports;
const fetchReport = (kind: ReportKind, from: string, to: string) =>
  unwrap(kind === "payroll" ? op.payroll.$get({ query: { from, to } }) : op["leave-detail"].$get({ query: { from, to } }));

export type ReportData = Awaited<ReturnType<typeof fetchReport>>;
export type ReportColumn = ReportData["columns"][number];

export function useReport(kind: ReportKind, from: string, to: string, enabled = true) {
  return useQuery({ queryKey: queryKeys.report(kind, from, to), queryFn: () => fetchReport(kind, from, to), enabled });
}

/** Path + query of the download route, built by the typed client. */
export function exportUrl(kind: ReportKind, from: string, to: string, format: ExportFormat): string {
  const ops = apiForUrls().api.operator.reports;
  const route = kind === "payroll" ? ops.payroll.export : ops["leave-detail"].export;
  const url = route.$url({ query: { from, to, format } });
  return url.pathname + url.search;
}
