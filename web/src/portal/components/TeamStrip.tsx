// "2 of 5 in Logistics away: Sami (12 to 16), Ines (14)": names and "Away" only (spec 1.7).
// Props-only; the data is the server's Away projection plus the count from the preview issue.
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PortalTeam } from "@/common/api/portal";
import { formatRange } from "@/common/lib/format";

export type TeamCount = { count: number; size: number; department: string } | null;

export function TeamStrip({ team, counts }: { team: PortalTeam; counts: TeamCount }) {
  const { t, i18n } = useTranslation();
  if (team.scope === "off" || team.people.length === 0) return null;
  const to = t("common.to");
  const people = team.people
    .map((p) => `${p.fullName.split(" ")[0]} (${formatRange(p.startDate, p.endDate, i18n.language, to, false)})`)
    .join(", ");
  return (
    <p className="flex items-start gap-2 rounded-md border bg-muted/50 px-3 py-2" data-testid="team-strip">
      <Users size={14} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>{counts ? t("portal.team.strip", { ...counts, people }) : t("portal.team.stripShort", { people })}</span>
    </p>
  );
}
