import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDays } from "@/common/lib/format";
import { cn } from "@/lib/utils";

/** "Paid leave: 12 -> 7.5 days", red when the result is negative. Figures come from the server preview. */
export function BalancePreview({ typeName, available, after }: { typeName: string; available: number; after: number }) {
  const { t, i18n } = useTranslation();
  const negative = after < 0;
  return (
    <p className={cn("flex items-center gap-1.5 tabular-nums", negative && "text-balance-negative font-medium")} data-testid="balance-preview">
      {negative ? <AlertTriangle size={14} aria-hidden="true" /> : null}
      {t("leave.balancePreview", {
        type: typeName,
        from: formatDays(available, i18n.language),
        to: formatDays(after, i18n.language),
        count: after,
      })}
    </p>
  );
}
