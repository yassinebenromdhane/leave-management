import { isValidHalfCombination, type HalfDay } from "@leave/shared";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type HalfPosition = "first" | "last" | "single";

/**
 * Half-day options per position (spec 1.2): a single day may be full / morning / afternoon; in a
 * multi-day range the first day is full or afternoon-only and the last day full or morning-only.
 */
export function halfOptions(position: HalfPosition): HalfDay[] {
  if (position === "single") return ["full", "am", "pm"];
  return position === "first" ? ["full", "pm"] : ["full", "am"];
}

/** Makes a (startHalf, endHalf) pair valid for the given dates; keeps the user's choice when it already is. */
export function normalizeHalves(
  startDate: string,
  endDate: string,
  startHalf: HalfDay,
  endHalf: HalfDay,
): { startHalf: HalfDay; endHalf: HalfDay } {
  const span = { startDate, endDate, startHalf, endHalf };
  if (isValidHalfCombination(span)) return { startHalf, endHalf };
  if (startDate === endDate) return { startHalf, endHalf: startHalf };
  return { startHalf: startHalf === "am" ? "full" : startHalf, endHalf: endHalf === "pm" ? "full" : endHalf };
}

export function HalfDayToggle({
  value,
  position,
  onChange,
  label,
  touch,
}: {
  value: HalfDay;
  position: HalfPosition;
  onChange: (value: HalfDay) => void;
  label: string;
  /** 44 px targets at every width (phone layout). */
  touch?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border p-0.5">
      {halfOptions(position).map((h) => (
        <button
          key={h}
          type="button"
          role="radio"
          aria-checked={value === h}
          onClick={() => onChange(h)}
          className={cn(
            "h-7 rounded px-2.5 text-meta max-md:h-11 max-md:px-3",
            touch && "h-11 min-w-11 px-3",
            value === h ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {t(`halfDay.${h}`)}
        </button>
      ))}
    </div>
  );
}
