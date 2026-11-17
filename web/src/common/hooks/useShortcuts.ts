// One keyboard hook for the whole app (spec 2.2). Single-character keys (letters, digits, "?",
// "/", arrows) are inert while a text field, select or contenteditable has focus; chords with
// Ctrl/Cmd and Escape always work.
import { useEffect, useRef } from "react";

export type ShortcutHandler = (event: KeyboardEvent) => void;
export type ShortcutMap = Record<string, ShortcutHandler>;

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
]);

/** True when typing into the target would be hijacked by a single-letter shortcut. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  const el = target as HTMLElement;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return TEXT_INPUT_TYPES.has((el as HTMLInputElement).type || "text");
  return el.isContentEditable || el.getAttribute("contenteditable") === "true" || el.getAttribute("role") === "textbox";
}

type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/** Canonical id of a key press: modifiers in the order mod, alt, shift, then the lowercase key. */
export function shortcutId(e: KeyLike): string {
  const parts: string[] = [];
  const mod = e.ctrlKey || e.metaKey;
  if (mod) parts.push("mod");
  if (e.altKey) parts.push("alt");
  // Shift is already part of a printable character ("?"), so it only matters in chords and named keys.
  if (e.shiftKey && (mod || e.altKey || e.key.length > 1)) parts.push("shift");
  parts.push(e.key.toLowerCase());
  return parts.join("+");
}

/** Whether a shortcut id may fire while a text field has focus. */
export const worksWhileTyping = (id: string): boolean => id.startsWith("mod+") || id === "escape";

/** Decides, without side effects, which handler of `map` the event triggers (exported for tests). */
export function resolveShortcut(map: ShortcutMap, e: KeyboardEvent): ShortcutHandler | null {
  const id = shortcutId(e);
  const handler = map[id];
  if (!handler) return null;
  if (!worksWhileTyping(id) && (isTypingTarget(e.target) || e.repeat)) return null;
  return handler;
}

export function useShortcuts(map: ShortcutMap, enabled = true): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const handler = resolveShortcut(ref.current, e);
      if (!handler) return;
      e.preventDefault();
      handler(e);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
}
