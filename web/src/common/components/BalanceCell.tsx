import { useTranslation } from "react-i18next";
import { formatDays } from "@/common/lib/format";
import { cn } from "@/lib/utils";

export type BalanceTone = "negative" | "low" | "ok";

/** Spec 1.1: red below 0, amber below 2. */
export function balanceTone(available: number): BalanceTone {
  if (available < 0) return "negative";
  if (available < 2) return "low";
  return "ok";
}

const TONE_CLASS: Record<BalanceTone, string> = {
  negative: "text-balance-negative",
  low: "text-balance-low",
  ok: "text-foreground",
};

/** Remaining (available) days big, "taken · pending" muted below. */
export function BalanceCell({ available, taken, pending, className }: { available: number; taken: number; pending: number; className?: string }) {
  const { t, i18n } = useTranslation();
  const tone = balanceTone(available);
  const nf = (n: number) => formatDays(n, i18n.language);
  return (
    <div className={cn("leading-tight tabular-nums", className)} data-tone={tone}>
      <div className={cn("text-table font-semibold", TONE_CLASS[tone])} data-testid="balance-main">
        {nf(available)}
      </div>
      <div className="text-meta text-muted-foreground">{t("balance.takenPending", { taken: nf(taken), pending: nf(pending) })}</div>
    </div>
  );
}
