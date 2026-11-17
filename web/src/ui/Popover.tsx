// Small anchored popover (menus, status picker). Fixed positioning so it is never clipped by a
// scrolling table container. Shadow is allowed here: it is an overlay.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useOverlay } from "./useOverlay";

export function Popover({
  anchor,
  onClose,
  children,
  label,
  className,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useOverlay(true, onClose, ref, { trap: false });

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    const left = Math.max(8, Math.min(a.left, window.innerWidth - w - 8));
    const below = a.bottom + 4;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, a.top - h - 4) : below;
    setPos({ top, left });
  }, [anchor]);

  useLayoutEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = e.target as Node;
      if (ref.current?.contains(el) || anchor?.contains(el)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
      className={cn("fixed z-[70] min-w-40 rounded-md border bg-background p-1 shadow-overlay", className)}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-8 w-full items-center gap-2 rounded px-2 text-start hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-50 max-md:min-h-11",
        tone === "danger" && "text-status-rejected",
      )}
    >
      {children}
    </button>
  );
}
