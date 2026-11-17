// Shared behaviour of drawers, sheets, dialogs and popovers: focus trap, Escape closes the
// top-most overlay only, and focus returns to the element that opened it.
import { useEffect, useRef, type RefObject } from "react";

const stack: symbol[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function useOverlay(open: boolean, onClose: () => void, containerRef: RefObject<HTMLElement | null>, opts: { trap?: boolean; autoFocus?: boolean } = {}): void {
  const { trap = true, autoFocus = true } = opts;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const id = Symbol("overlay");
    stack.push(id);
    const opener = document.activeElement as HTMLElement | null;
    const container = containerRef.current;

    if (autoFocus && container && !container.contains(document.activeElement)) {
      // Respect an autoFocus child; otherwise focus the first control, falling back to the container.
      const first = container.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(container)[0];
      (first ?? container).focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (trap && e.key === "Tab" && container) {
        const items = focusables(container);
        if (items.length === 0) {
          e.preventDefault();
          container.focus();
          return;
        }
        const first = items[0]!;
        const last = items[items.length - 1]!;
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !container.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !container.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open, trap, autoFocus, containerRef]);
}
