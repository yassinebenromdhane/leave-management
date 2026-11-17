// Inline editing (spec 1.1): double-click (or Enter / F2 on the focused cell) to edit, Enter saves,
// Esc cancels, Tab saves and moves to the next editable cell.
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Move = 1 | -1 | 0;

export function EditableCell({
  label,
  value,
  editing,
  onStart,
  onCommit,
  onCancel,
  children,
  options,
  inputMode,
  type = "text",
  className,
}: {
  label: string;
  value: string;
  editing: boolean;
  onStart: () => void;
  /** `move` is 1 / -1 for Tab / Shift+Tab, 0 for Enter or blur. */
  onCommit: (value: string, move: Move) => void;
  onCancel: () => void;
  children: ReactNode;
  options?: Array<{ value: string; label: string }>;
  inputMode?: "text" | "decimal" | "email";
  type?: string;
  className?: string;
}) {
  const done = useRef(false);
  const finish = (v: string, move: Move) => {
    if (done.current) return;
    done.current = true;
    onCommit(v, move);
  };

  if (!editing) {
    return (
      <td
        tabIndex={0}
        aria-label={label}
        onDoubleClick={onStart}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === "F2")) {
            e.preventDefault();
            onStart();
          }
        }}
        className={cn("px-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent", className)}
      >
        {children}
      </td>
    );
  }

  done.current = false;
  const keyHandler = (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = e.currentTarget.value;
    if (e.key === "Enter") {
      e.preventDefault();
      finish(v, 0);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      done.current = true;
      onCancel();
    } else if (e.key === "Tab") {
      e.preventDefault();
      finish(v, e.shiftKey ? -1 : 1);
    }
  };

  return (
    <td className={cn("px-1", className)}>
      {options ? (
        <select autoFocus aria-label={label} defaultValue={value} onKeyDown={keyHandler} onBlur={(e) => finish(e.currentTarget.value, 0)} className="h-8 w-full rounded border bg-background px-1">
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          autoFocus
          type={type}
          inputMode={inputMode}
          aria-label={label}
          defaultValue={value}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={keyHandler}
          onBlur={(e) => finish(e.currentTarget.value, 0)}
          className="h-8 w-full min-w-24 rounded border bg-background px-2"
        />
      )}
    </td>
  );
}
