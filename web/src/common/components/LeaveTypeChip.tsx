import { paletteHex, type PaletteKey } from "@leave/shared";
import { cn } from "@/lib/utils";

/** Leave type = one hue of the fixed 8-colour palette. `shortcut` shows the 1-9 key hint. */
export function LeaveTypeChip({
  name,
  color,
  selected,
  shortcut,
  onClick,
  className,
  touch,
}: {
  name: string;
  color: string;
  selected?: boolean;
  shortcut?: number;
  onClick?: () => void;
  className?: string;
  /** 44 px target at every width (phone layout). */
  touch?: boolean;
}) {
  const hex = paletteHex(color as PaletteKey);
  const body = (
    <>
      <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: hex }} aria-hidden="true" />
      <span className="truncate">{name}</span>
      {shortcut ? <kbd className="ms-1 text-meta text-muted-foreground tabular-nums">{shortcut}</kbd> : null}
    </>
  );
  const style = { backgroundColor: `${hex}${selected ? "33" : "14"}`, borderColor: selected ? hex : `${hex}55` };
  const base = "inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border px-2 text-meta";
  if (!onClick) {
    return (
      <span className={cn(base, className)} style={style}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      style={style}
      className={cn(base, "cursor-pointer max-md:h-11 max-md:px-3", touch && "h-11 px-3", className)}
    >
      {body}
    </button>
  );
}
