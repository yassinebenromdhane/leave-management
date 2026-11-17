import { AlertCircle, Check } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export const UNDO_MS = 6000;

/** One toast. Auto-dismisses after `durationMs` (6 s for Undo toasts); Undo is a button, not a cache revert. */
export function UndoToast({
  message,
  tone = "success",
  onUndo,
  onDismiss,
  durationMs = UNDO_MS,
}: {
  message: string;
  tone?: "success" | "error";
  onUndo?: () => void;
  onDismiss: () => void;
  durationMs?: number;
}) {
  const { t } = useTranslation();
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const id = setTimeout(() => dismissRef.current(), durationMs);
    return () => clearTimeout(id);
  }, [durationMs]);

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto relative flex min-h-11 items-center gap-3 overflow-hidden rounded-md border bg-foreground px-3 py-2 text-background shadow-overlay",
        tone === "error" && "border-status-rejected",
      )}
    >
      {tone === "error" ? <AlertCircle size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
      <span className="flex-1">{message}</span>
      {onUndo ? (
        <button type="button" onClick={onUndo} className="h-8 rounded px-2 font-medium underline underline-offset-2 hover:bg-background/10 max-md:h-11">
          {t("common.undo")}
        </button>
      ) : null}
      <button type="button" onClick={onDismiss} aria-label={t("common.dismiss")} className="h-8 w-8 rounded hover:bg-background/10 max-md:h-11 max-md:w-11">
        ×
      </button>
      <span
        aria-hidden="true"
        className="toast-timer absolute inset-x-0 bottom-0 h-0.5 bg-background/60"
        style={{ animationDuration: `${durationMs}ms` }}
      />
    </div>
  );
}
