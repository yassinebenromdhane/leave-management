import type { LeaveStatus } from "@leave/shared";
import { ChevronDown } from "lucide-react";
import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const DOT: Record<LeaveStatus, string> = {
  pending: "bg-status-pending",
  approved: "bg-status-approved",
  rejected: "bg-status-rejected",
  cancelled: "bg-status-cancelled",
};

/** Status = dot + text label, never colour alone. Becomes a button when `onClick` is given. */
export const StatusPill = forwardRef<
  HTMLButtonElement,
  { status: LeaveStatus; onClick?: () => void; className?: string; disabled?: boolean }
>(function StatusPill({ status, onClick, className, disabled }, ref) {
  const { t } = useTranslation();
  const body = (
    <>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[status])} data-testid="status-dot" aria-hidden="true" />
      <span>{t(`status.${status}`)}</span>
    </>
  );
  const base = "inline-flex h-5 items-center gap-1.5 rounded-full border bg-background px-2 text-meta whitespace-nowrap";
  if (!onClick) return <span className={cn(base, className)}>{body}</span>;
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-haspopup="menu"
      aria-label={t("status.change", { status: t(`status.${status}`) })}
      className={cn(base, "cursor-pointer hover:bg-muted max-md:h-8", className)}
    >
      {body}
      <ChevronDown size={11} aria-hidden="true" className="text-muted-foreground" />
    </button>
  );
});
