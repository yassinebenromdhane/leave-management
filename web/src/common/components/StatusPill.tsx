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

/** Soft tinted pill per status; the text label stays the primary cue (AA contrast on the tint). */
const TINT: Record<LeaveStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  rejected: "border-red-200 bg-red-50 text-red-700",
  cancelled: "border-slate-200 bg-slate-50 text-slate-600",
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
  const base = cn("inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-meta font-medium whitespace-nowrap", TINT[status]);
  if (!onClick) return <span className={cn(base, className)}>{body}</span>;
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-haspopup="menu"
      aria-label={t("status.change", { status: t(`status.${status}`) })}
      className={cn(base, "cursor-pointer transition-[filter] hover:brightness-95 max-md:h-8", className)}
    >
      {body}
      <ChevronDown size={11} aria-hidden="true" className="opacity-60" />
    </button>
  );
});
