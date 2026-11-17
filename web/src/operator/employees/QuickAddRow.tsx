// Quick add (spec 1.1): the empty last row. Three fields (name, department, hire date); Enter saves
// and opens the next row. Opening balances live behind a small expander so the row stays at 3 fields.
import { employeeCreateSchema } from "@leave/shared";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { useEmployeeMutations } from "@/common/api/employees";
import type { LeaveTypeRef, Reference } from "@/common/api/reference";
import { todayIso } from "@/common/lib/date";
import { errorMessage } from "@/common/lib/errorMessage";
import { useToast } from "@/common/toast/ToastProvider";

type Mutations = ReturnType<typeof useEmployeeMutations>;
const NEW_DEPARTMENT = "__new__";

export function QuickAddRow({ reference, deducting, mutations, columns }: { reference: Reference; deducting: LeaveTypeRef[]; mutations: Mutations; columns: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [newDepartment, setNewDepartment] = useState("");
  const [hireDate, setHireDate] = useState(todayIso());
  const [opening, setOpening] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const creatingDepartment = departmentId === NEW_DEPARTMENT;

  const submit = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      let deptId = departmentId;
      if (creatingDepartment) {
        if (!newDepartment.trim()) return setError(t("errors.required"));
        const dept = await mutations.createDepartment.mutateAsync({ name: newDepartment });
        deptId = dept.id;
        setDepartmentId(dept.id);
        setNewDepartment("");
      }
      const openingBalances = deducting
        .map((x) => ({ leaveTypeId: x.id, days: Number((opening[x.id] ?? "").replace(",", ".")) }))
        .filter((o) => Number.isFinite(o.days) && o.days !== 0 && (opening[o.leaveTypeId] ?? "").trim() !== "");
      const input = { fullName: name, departmentId: deptId, hireDate, openingBalances };
      const parsed = employeeCreateSchema.safeParse(input);
      if (!parsed.success) return setError(parsed.error.issues.map((i) => t(i.message)).join(" "));
      const created = await mutations.create.mutateAsync(input);
      toast({ message: t("employees.added", { name: created.fullName }), onUndo: () => mutations.archive.mutateAsync(created.id).then(() => undefined) });
      setName("");
      setOpening({});
      setExpanded(false);
      document.getElementById("quick-add-name")?.focus(); // Enter opens the next row
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  };

  const input = "h-8 w-full rounded border bg-background px-2 max-md:h-11";
  return (
    <>
      <tr className="h-9 border-b bg-muted/30">
        <td className="px-1">
          <input
            id="quick-add-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onEnter}
            aria-label={t("employees.quickAdd.name")}
            placeholder={t("employees.quickAdd.name")}
            className={input}
          />
        </td>
        <td className="px-1">
          {creatingDepartment ? (
            <input
              autoFocus
              value={newDepartment}
              onChange={(e) => setNewDepartment(e.target.value)}
              onKeyDown={(e) => {
                onEnter(e);
                if (e.key === "Escape") setDepartmentId("");
              }}
              aria-label={t("employees.quickAdd.newDepartment")}
              placeholder={t("employees.quickAdd.newDepartment")}
              className={input}
            />
          ) : (
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} onKeyDown={onEnter} aria-label={t("employees.quickAdd.department")} className={input}>
              <option value="">{t("employees.quickAdd.department")}</option>
              {reference.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
              <option value={NEW_DEPARTMENT}>{t("employees.quickAdd.addDepartment")}</option>
            </select>
          )}
        </td>
        <td className="px-1">
          <input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} onKeyDown={onEnter} aria-label={t("employees.col.hireDate")} className={`${input} tabular-nums`} />
        </td>
        <td colSpan={columns - 3} className="px-2">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded} className="inline-flex h-8 items-center gap-1 rounded px-1.5 text-muted-foreground hover:bg-muted max-md:h-11">
              {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
              {t("employees.quickAdd.opening")}
            </button>
            <button type="button" onClick={() => void submit()} disabled={busy || !name.trim()} className="inline-flex h-8 items-center gap-1 rounded-md bg-accent px-3 text-accent-foreground disabled:opacity-50 max-md:h-11">
              <Plus size={14} aria-hidden="true" />
              {t("employees.quickAdd.add")}
            </button>
            <span className="text-meta text-muted-foreground max-md:hidden">{t("employees.quickAdd.hint")}</span>
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b bg-muted/30">
          <td colSpan={columns} className="px-3 py-2">
            <div className="flex flex-wrap items-end gap-3">
              {deducting.map((x) => (
                <label key={x.id} className="space-y-0.5">
                  <span className="block text-meta text-muted-foreground">{t("employees.quickAdd.openingFor", { type: x.name })}</span>
                  <input
                    inputMode="decimal"
                    value={opening[x.id] ?? ""}
                    onChange={(e) => setOpening((o) => ({ ...o, [x.id]: e.target.value }))}
                    onKeyDown={onEnter}
                    className={`${input} w-28 tabular-nums`}
                  />
                </label>
              ))}
            </div>
          </td>
        </tr>
      ) : null}
      {error ? (
        <tr>
          <td colSpan={columns} className="px-3 py-1.5">
            <p role="alert" className="text-status-rejected">
              {error}
            </p>
          </td>
        </tr>
      ) : null}
    </>
  );
}
