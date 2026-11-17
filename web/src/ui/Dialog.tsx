// Centered modal for destructive confirmations, one-time secrets and the shortcut sheet.
import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useOverlay } from "./useOverlay";

export function Dialog({
  title,
  onClose,
  children,
  actions,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlay(true, onClose, ref);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/30 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn("w-full max-w-md rounded-lg border bg-background p-5 shadow-overlay outline-none", className)}
      >
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <div className="mt-3">{children}</div>
        {actions ? <div className="mt-5 flex justify-end gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  destructive,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      actions={
        <>
          <button type="button" onClick={onCancel} data-autofocus className="h-9 rounded-md border px-3 hover:bg-muted max-md:h-11">
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              "h-9 rounded-md px-3 text-accent-foreground max-md:h-11",
              destructive ? "bg-status-rejected" : "bg-accent",
            )}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-muted-foreground">{message}</p>
    </Dialog>
  );
}
