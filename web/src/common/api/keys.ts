// TanStack Query keys: one factory per resource. Invalidate through these, never ad-hoc arrays.
export const queryKeys = {
  health: ["health"] as const,
  session: ["session"] as const,
  reference: ["reference"] as const,
  employees: (status?: string) => (status ? (["employees", status] as const) : (["employees"] as const)),
  employee: (id: string) => ["employee", id] as const,
  leaves: (filters?: object) => (filters ? (["leaves", filters] as const) : (["leaves"] as const)),
  leave: (id: string) => ["leave", id] as const,
  settings: (year?: number) => (year ? (["settings", year] as const) : (["settings"] as const)),
  holidays: (year: number) => ["holidays", year] as const,
  report: (kind: string, from: string, to: string) => ["report", kind, from, to] as const,
  // employee portal (/api/me/*): everything under the "portal" root so one prefix clears it
  portal: ["portal"] as const,
  portalReference: ["portal", "reference"] as const,
  portalDashboard: ["portal", "dashboard"] as const,
  portalLeaves: ["portal", "leaves"] as const,
  portalLedger: (leaveTypeId?: string) => (leaveTypeId ? (["portal", "ledger", leaveTypeId] as const) : (["portal", "ledger"] as const)),
  portalTeam: (from: string, to: string) => ["portal", "team", from, to] as const,
  portalPreview: (payload: object) => ["portal", "preview", payload] as const,
  leavePreview: (payload: object) => ["leave-preview", payload] as const,
};
