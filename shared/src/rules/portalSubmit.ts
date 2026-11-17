// Portal-only decisions on top of evaluateLeave(context 'portal') (spec 1.7 portal check table).
// The browser calls these for the request sheet; the server calls them as the final authority.
import type { TeamVisibility } from "../types";
import type { ConflictResult, Issue } from "./conflicts";

export type PortalSubmitVerdict =
  | { ok: true }
  | { ok: false; reason: "blocked" }
  | { ok: false; reason: "acknowledgeNegative" };

/**
 * - Any blocking issue (overlap, zero days, outside employment, negative beyond what is allowed,
 *   required attachment missing for a non-sick type) → blocked.
 * - An allowed negative balance (a `negativeBalance` WARNING) must be acknowledged.
 * - Everything else (colleagues off, sick certificate expected) is informational.
 */
export function portalSubmitVerdict(conflicts: ConflictResult, acknowledgeNegative: boolean): PortalSubmitVerdict {
  if (conflicts.blocking.length > 0) return { ok: false, reason: "blocked" };
  const negative = conflicts.warnings.some((w) => w.code === "conflicts.negativeBalance");
  if (negative && !acknowledgeNegative) return { ok: false, reason: "acknowledgeNegative" };
  return { ok: true };
}

/**
 * The conflict result as an EMPLOYEE may see it. Colleague names never leave the server through
 * this path (the "Away" strip carries them, under the team-visibility setting); with team
 * visibility `off`, the colleagues-off issue is dropped entirely.
 */
export function portalConflictsView(conflicts: ConflictResult, visibility: TeamVisibility): ConflictResult {
  const clean = (list: Issue[]): Issue[] =>
    list.flatMap((issue): Issue[] => {
      if (issue.code !== "conflicts.colleaguesOff") return [issue];
      if (visibility === "off") return [];
      const params = { ...(issue.params ?? {}) };
      delete params.people;
      return [{ ...issue, params }];
    });
  return { blocking: clean(conflicts.blocking), warnings: clean(conflicts.warnings) };
}
