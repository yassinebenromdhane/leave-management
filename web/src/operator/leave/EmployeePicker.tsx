// Employee type-ahead (spec 1.2): the 5 most recent first, autofocus, Enter picks the highlighted
// row. Props-only.
import { Search, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type PickerEmployee = { id: string; fullName: string; employeeCode: string | null; departmentName: string };

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Matches name or employee code, ignoring case and accents. Empty query = 5 most recent, then alphabetical. */
export function filterEmployees(all: readonly PickerEmployee[], query: string, recentIds: readonly string[]): PickerEmployee[] {
  const q = fold(query.trim());
  if (!q) {
    const byId = new Map(all.map((e) => [e.id, e]));
    const recent = recentIds.map((id) => byId.get(id)).filter((e): e is PickerEmployee => Boolean(e)).slice(0, 5);
    const rest = all.filter((e) => !recent.includes(e)).slice(0, Math.max(0, 5 - recent.length));
    return [...recent, ...rest];
  }
  return all.filter((e) => fold(e.fullName).includes(q) || (e.employeeCode ? fold(e.employeeCode).includes(q) : false)).slice(0, 8);
}

export function EmployeePicker({
  employees,
  recentIds,
  value,
  onSelect,
  onClear,
}: {
  employees: readonly PickerEmployee[];
  recentIds: readonly string[];
  value: PickerEmployee | null;
  onSelect: (id: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const results = useMemo(() => filterEmployees(employees, query, recentIds), [employees, query, recentIds]);

  if (value) {
    return (
      <div className="flex min-h-9 items-center justify-between gap-2 rounded-md border px-3 py-1.5">
        <span className="min-w-0 truncate">
          <span className="font-medium">{value.fullName}</span>
          <span className="text-muted-foreground"> · {value.departmentName}</span>
        </span>
        <button type="button" onClick={onClear} aria-label={t("leave.changeEmployee")} className="grid h-7 w-7 place-items-center rounded hover:bg-muted max-md:h-11 max-md:w-11">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    );
  }

  const choose = (e: PickerEmployee | undefined) => {
    if (!e) return;
    setQuery("");
    onSelect(e.id);
  };

  return (
    <div>
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          data-autofocus
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results[active] ? `${listId}-${results[active]!.id}` : undefined}
          aria-label={t("leave.employee")}
          placeholder={t("leave.employeePlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              choose(results[active]);
            }
          }}
          className="h-9 w-full rounded-md border bg-background ps-8 pe-2 max-md:h-11"
        />
      </div>
      {!query ? <p className="mt-1.5 text-meta text-muted-foreground">{t("leave.recent")}</p> : null}
      <ul id={listId} role="listbox" aria-label={t("leave.employee")} className="mt-1 divide-y rounded-md border">
        {results.length === 0 ? <li className="px-3 py-2 text-muted-foreground">{t("leave.noEmployee")}</li> : null}
        {results.map((e, i) => (
          <li
            key={e.id}
            id={`${listId}-${e.id}`}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(ev) => {
              ev.preventDefault();
              choose(e);
            }}
            className={cn("flex min-h-9 cursor-pointer items-center justify-between gap-2 px-3 max-md:min-h-11", i === active && "bg-accent/10")}
          >
            <span className="truncate font-medium">{e.fullName}</span>
            <span className="shrink-0 text-meta text-muted-foreground">{e.departmentName}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
