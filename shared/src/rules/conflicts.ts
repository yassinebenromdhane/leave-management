// Pure part of spec 1.3 (operator) and the portal table in spec 1.7.
// The server gathers the facts (existing leaves, balance, colleagues off, settings) and calls
// evaluateLeave(); the drawer calls the same function for the live conflict strip.
//
// "Warn, don't block" (CLAUDE.md invariant 8): only impossible data is blocking.
import type { HalfDay, IsoDate } from "../types";
import { eachIsoDate } from "./dates";
import { fromHalves, toHalves } from "./halfDays";
import type { LeaveSpan } from "./workingDays";

export type IssueCode =
  | "conflicts.selfOverlap"
  | "conflicts.zeroDays"
  | "conflicts.outsideEmployment"
  | "conflicts.negativeBalance"
  | "conflicts.colleaguesOff"
  | "conflicts.attachmentMissing";

export type Issue = {
  code: IssueCode;
  severity: "blocking" | "warning";
  params?: Record<string, string | number | null | Array<Record<string, string | null>>>;
};

export type ConflictResult = { blocking: Issue[]; warnings: Issue[] };

type Slot = "am" | "pm";

/** The half-day slots a leave occupies on each date (for overlap at half-day precision). */
export function occupiedSlots(span: LeaveSpan): Map<IsoDate, Set<Slot>> {
  const dates = eachIsoDate(span.startDate, span.endDate);
  const out = new Map<IsoDate, Set<Slot>>();
  dates.forEach((d, i) => {
    const slots = new Set<Slot>(["am", "pm"]);
    const first = i === 0;
    const last = i === dates.length - 1;
    const only = (h: HalfDay) => (h === "am" ? "pm" : h === "pm" ? "am" : null);
    if (first) {
      const drop = only(span.startHalf);
      if (drop) slots.delete(drop);
    }
    if (last && !first) {
      const drop = only(span.endHalf);
      if (drop) slots.delete(drop);
    }
    out.set(d, slots);
  });
  return out;
}

export function spansOverlap(a: LeaveSpan, b: LeaveSpan): boolean {
  if (a.endDate < b.startDate || b.endDate < a.startDate) return false;
  const sa = occupiedSlots(a);
  for (const [date, slots] of occupiedSlots(b)) {
    const other = sa.get(date);
    if (other && [...slots].some((s) => other.has(s))) return true;
  }
  return false;
}

export type ExistingLeave = LeaveSpan & { id: string; leaveTypeName: string };
export type ColleagueOff = { name: string; startDate: IsoDate; endDate: IsoDate };

export type EvaluateInput = {
  context: "operator" | "portal";
  span: LeaveSpan;
  days: number; // workingDays() result for this leave
  employment: { hireDate: IsoDate; endDate: IsoDate | null };
  /** The employee's own non-deleted Pending/Approved leaves, excluding the one being edited. */
  ownLeaves: readonly ExistingLeave[];
  /** Null when the leave type does not deduct from a balance. */
  balance: { available: number } | null;
  settings: { allowNegative: boolean; negativeLimitDays: number };
  department: { name: string; size: number; colleaguesOff: readonly ColleagueOff[] };
  attachment: { required: boolean; present: boolean; isSickLeave: boolean };
};

export function evaluateLeave(input: EvaluateInput): ConflictResult {
  const blocking: Issue[] = [];
  const warnings: Issue[] = [];
  const { span } = input;

  // Same employee already off (blocking), with a link to the first clash.
  const clash = input.ownLeaves.find((l) => spansOverlap(l, span));
  if (clash) {
    blocking.push({
      code: "conflicts.selfOverlap",
      severity: "blocking",
      params: { leaveId: clash.id, type: clash.leaveTypeName, start: clash.startDate, end: clash.endDate },
    });
  }

  if (input.days <= 0) blocking.push({ code: "conflicts.zeroDays", severity: "blocking" });

  const { hireDate, endDate } = input.employment;
  if (span.startDate < hireDate || (endDate !== null && span.endDate > endDate)) {
    blocking.push({ code: "conflicts.outsideEmployment", severity: "blocking", params: { hireDate, endDate } });
  }

  // Balance: blocking when negatives are disabled or beyond the allowed limit; otherwise a warning.
  if (input.balance) {
    const after = toHalves(input.balance.available) - toHalves(input.days);
    if (after < 0) {
      const exceeds = fromHalves(-after);
      const beyondLimit = !input.settings.allowNegative || exceeds > input.settings.negativeLimitDays;
      (beyondLimit ? blocking : warnings).push({
        code: "conflicts.negativeBalance",
        severity: beyondLimit ? "blocking" : "warning",
        params: { exceeds, limit: input.settings.allowNegative ? input.settings.negativeLimitDays : 0 },
      });
    }
  }

  // Colleagues in the same department already off (warning on both sides; informational on the portal).
  const off = input.department.colleaguesOff.filter((c) => !(c.endDate < span.startDate || span.endDate < c.startDate));
  if (off.length > 0) {
    warnings.push({
      code: "conflicts.colleaguesOff",
      severity: "warning",
      params: {
        count: off.length,
        size: input.department.size,
        department: input.department.name,
        people: off.map((c) => ({ name: c.name, start: c.startDate, end: c.endDate })),
      },
    });
  }

  // Attachment: operator warns; portal allows sick leave without it (flagged) and blocks the rest.
  if (input.attachment.required && !input.attachment.present) {
    const block = input.context === "portal" && !input.attachment.isSickLeave;
    (block ? blocking : warnings).push({ code: "conflicts.attachmentMissing", severity: block ? "blocking" : "warning" });
  }

  return { blocking, warnings };
}
