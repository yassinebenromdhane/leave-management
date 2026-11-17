// Right-hand slide-over (480 px) on desktop, full-height bottom sheet under 768 px.
// Focus is trapped and restored, Esc closes, the page behind stays visible and live.
import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useOverlay } from "./useOverlay";

export function Sheet({
  title,
  onClose,
  children,
  footer,
  headerExtra,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  headerExtra?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  useOverlay(true, onClose, ref);

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={onClose} aria-hidden="true" />
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "sheet-in fixed z-40 flex flex-col bg-background shadow-overlay outline-none",
          "inset-y-0 end-0 w-[480px] max-w-full border-s",
          "max-md:inset-x-0 max-md:bottom-0 max-md:top-10 max-md:w-full max-md:rounded-t-xl max-md:border-s-0 max-md:border-t",
          className,
        )}
      >
        <header className="flex min-h-12 items-center gap-2 border-b px-4">
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h2>
          {headerExtra}
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted max-md:h-11 max-md:w-11"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? <footer className="border-t bg-background px-4 py-3">{footer}</footer> : null}
      </aside>
    </>
  );
}
