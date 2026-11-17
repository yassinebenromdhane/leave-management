// Horizontal scroll row of balance cards (spec 1.7). Main figure = available. Props-only.
import { paletteHex, type PaletteKey } from "@leave/shared";
import { useTranslation } from "react-i18next";
import type { PortalBalance } from "@/common/api/portal";
import { formatDays } from "@/common/lib/format";
import { cn } from "@/lib/utils";

export function BalanceCards({ balances, onSelect }: { balances: readonly PortalBalance[]; onSelect: (b: PortalBalance) => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  if (balances.length === 0) return null;
  return (
    <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1" aria-label={t("portal.balances")}>
      {balances.map((b) => (
        <li key={b.leaveTypeId} className="snap-start">
          <button
            type="button"
            onClick={() => onSelect(b)}
            aria-label={t("portal.openLedger", { type: b.name })}
            className="flex min-h-[96px] min-w-[148px] flex-col items-start gap-1 rounded-lg border p-3 text-start hover:bg-muted"
          >
            <span className="flex items-center gap-1.5 text-meta text-muted-foreground">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: paletteHex(b.color as PaletteKey) }} aria-hidden="true" />
              {b.name}
            </span>
            <span className={cn("text-[length:var(--text-kpi)] font-semibold tabular-nums", b.available < 0 && "text-balance-negative")}>
              {formatDays(b.available, locale)}
            </span>
            <span className="text-meta text-muted-foreground tabular-nums">
              {t("balance.takenPending", { taken: formatDays(b.taken, locale), pending: formatDays(b.pending, locale) })}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
