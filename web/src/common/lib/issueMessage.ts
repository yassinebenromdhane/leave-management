// Turns a conflict issue (shared evaluateLeave result, via preview or stored at save) into a
// translated sentence with locale-formatted dates and numbers.
import type { TFunction } from "i18next";
import { formatDay, formatDays, formatRange } from "./format";

export type IssueLike = { code: string; severity: string; params?: Record<string, unknown> | null };

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

export function issueMessage(t: TFunction, issue: IssueLike, locale: string): string {
  const p = issue.params ?? {};
  const to = t("common.to");
  switch (issue.code) {
    case "conflicts.selfOverlap":
      return t("conflicts.selfOverlap", {
        type: str(p.type).toLocaleLowerCase(locale),
        range: formatRange(str(p.start), str(p.end), locale, to),
      });
    case "conflicts.outsideEmployment": {
      const hire = formatDay(str(p.hireDate), locale, { day: "numeric", month: "short", year: "numeric" });
      const end = typeof p.endDate === "string" ? formatDay(p.endDate, locale, { day: "numeric", month: "short", year: "numeric" }) : null;
      return end ? t("conflicts.outsideEmploymentEnded", { hireDate: hire, endDate: end }) : t("conflicts.outsideEmployment", { hireDate: hire });
    }
    case "conflicts.negativeBalance":
      return t("conflicts.negativeBalance", { count: num(p.exceeds), formatted: formatDays(num(p.exceeds), locale) });
    case "conflicts.colleaguesOff": {
      const people = Array.isArray(p.people) ? (p.people as Array<Record<string, string | null>>) : [];
      return t("conflicts.colleaguesOff", {
        count: num(p.count),
        size: num(p.size),
        department: str(p.department),
        people: people.map((c) => `${c.name ?? ""} (${formatRange(c.start ?? "", c.end ?? "", locale, to, false)})`).join(", "),
      });
    }
    case "conflicts.zeroDays":
    case "conflicts.attachmentMissing":
      return t(issue.code);
    default:
      return t("errors.generic");
  }
}
