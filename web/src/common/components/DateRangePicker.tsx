// One range picker (spec 1.2): presets, two typed dates, and a month grid driven by the keyboard
// (arrows move, Enter picks the first then the last day). Props-only: no fetching.
import { addIsoDays, isoWeekday } from "@leave/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { addMonths, datePreset, PRESET_KEYS } from "@/common/lib/date";
import { formatDay } from "@/common/lib/format";
import { cn } from "@/lib/utils";

const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;

export function DateRangePicker({
  start,
  end,
  today,
  locale,
  onChange,
  isNonWorking,
  holidayName,
  gridRef,
  touch,
}: {
  start: string;
  end: string;
  today: string;
  locale: string;
  onChange: (start: string, end: string) => void;
  isNonWorking?: (iso: string) => boolean;
  holidayName?: (iso: string) => string | undefined;
  gridRef?: Ref<HTMLDivElement>;
  /** Phone layout: 44 px cells at every width, no presets and no typed dates (two taps pick the range). */
  touch?: boolean;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState(monthStart(start || today));
  const [focus, setFocus] = useState(start || today);
  const [picking, setPicking] = useState(false);
  const moved = useRef(false);
  const localRef = useRef<HTMLDivElement | null>(null);

  // Follow external changes (presets, typed dates, prefill).
  useEffect(() => {
    if (start) {
      setView(monthStart(start));
      setFocus(start);
    }
  }, [start]);

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    localRef.current?.querySelector<HTMLElement>(`[data-date="${focus}"]`)?.focus();
  }, [focus, view]);

  const setRef = (el: HTMLDivElement | null) => {
    localRef.current = el;
    if (typeof gridRef === "function") gridRef(el);
    else if (gridRef) (gridRef as { current: HTMLDivElement | null }).current = el;
  };

  const pick = (iso: string) => {
    if (!picking || !start) {
      onChange(iso, iso);
      setPicking(true);
    } else {
      onChange(iso < start ? iso : start, iso < start ? start : iso);
      setPicking(false);
    }
  };

  const gridStart = addIsoDays(view, -(isoWeekday(view) - 1));
  const cells = Array.from({ length: 42 }, (_, i) => addIsoDays(gridStart, i));
  const weekdays = Array.from({ length: 7 }, (_, i) => formatDay(addIsoDays("2024-01-01", i), locale, { weekday: "narrow" }));

  const onGridKey = (e: React.KeyboardEvent) => {
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next: string | null = null;
    if (e.key in delta) next = addIsoDays(focus, delta[e.key]!);
    else if (e.key === "PageUp") next = addMonths(focus, -1).slice(0, 8) + focus.slice(8);
    else if (e.key === "PageDown") next = addMonths(focus, 1).slice(0, 8) + focus.slice(8);
    if (!next) return;
    e.preventDefault();
    moved.current = true;
    setFocus(next);
    setView(monthStart(next));
  };

  const inRange = (iso: string) => start !== "" && end !== "" && iso >= start && iso <= end;

  return (
    <div className="space-y-2">
      <div className={cn("flex flex-wrap gap-1.5", touch && "hidden")} role="group" aria-label={t("datePicker.presets")}>
        {PRESET_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              const p = datePreset(key, today);
              setPicking(false);
              onChange(p.start, p.end);
            }}
            className="h-7 rounded-md border px-2.5 text-meta hover:bg-muted max-md:h-11 max-md:px-3"
          >
            {t(`datePicker.preset.${key}`)}
          </button>
        ))}
      </div>

      <div className={cn("grid grid-cols-2 gap-2", touch && "hidden")}>
        <label className="space-y-0.5">
          <span className="text-meta text-muted-foreground">{t("datePicker.from")}</span>
          <input
            type="date"
            value={start}
            onChange={(e) => {
              if (!e.target.value) return;
              setPicking(false);
              onChange(e.target.value, end && end >= e.target.value ? end : e.target.value);
            }}
            className="h-8 w-full rounded-md border bg-background px-2 tabular-nums max-md:h-11"
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-meta text-muted-foreground">{t("datePicker.to")}</span>
          <input
            type="date"
            value={end}
            min={start || undefined}
            onChange={(e) => {
              if (!e.target.value) return;
              setPicking(false);
              onChange(start && start <= e.target.value ? start : e.target.value, e.target.value);
            }}
            className="h-8 w-full rounded-md border bg-background px-2 tabular-nums max-md:h-11"
          />
        </label>
      </div>

      <div ref={setRef} className="rounded-md border p-2">
        <div className="mb-1 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setView(addMonths(view, -1))}
            aria-label={t("datePicker.prevMonth")}
            className={cn("grid h-7 w-7 place-items-center rounded hover:bg-muted max-md:h-11 max-md:w-11", touch && "h-11 w-11")}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span className="font-medium capitalize" aria-live="polite">
            {formatDay(view, locale, { month: "long", year: "numeric" })}
          </span>
          <button
            type="button"
            onClick={() => setView(addMonths(view, 1))}
            aria-label={t("datePicker.nextMonth")}
            className={cn("grid h-7 w-7 place-items-center rounded hover:bg-muted max-md:h-11 max-md:w-11", touch && "h-11 w-11")}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
        <div role="group" aria-label={t("datePicker.calendar")} onKeyDown={onGridKey} className="grid grid-cols-7 gap-px text-center">
          {weekdays.map((w, i) => (
            <div key={i} className="py-1 text-meta text-muted-foreground" aria-hidden="true">
              {w}
            </div>
          ))}
          {cells.map((iso) => {
            const outside = iso.slice(0, 7) !== view.slice(0, 7);
            const selectedEnd = iso === start || iso === end;
            const holiday = holidayName?.(iso);
            const label = `${formatDay(iso, locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}${holiday ? `, ${holiday}` : ""}`;
            return (
              <button
                key={iso}
                type="button"
                data-date={iso}
                tabIndex={iso === focus ? 0 : -1}
                aria-label={label}
                aria-pressed={inRange(iso)}
                title={holiday}
                onClick={() => {
                  setFocus(iso);
                  pick(iso);
                }}
                className={cn(
                  "relative h-8 rounded text-table tabular-nums max-md:h-11",
                  touch && "h-11 min-w-11",
                  outside && "opacity-40",
                  isNonWorking?.(iso) && !inRange(iso) && "bg-muted text-muted-foreground",
                  inRange(iso) && "bg-accent/15",
                  selectedEnd && "bg-accent text-accent-foreground",
                  iso === today && !selectedEnd && "font-bold ring-1 ring-inset ring-accent",
                  "hover:ring-1 hover:ring-accent",
                )}
              >
                {Number(iso.slice(8))}
                {holiday ? <span aria-hidden="true" className="absolute bottom-0.5 start-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-status-pending" /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
