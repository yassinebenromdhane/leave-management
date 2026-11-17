// Settings > Company (spec 1.5): identity, working week, leave year, negative balance, defaults,
// team visibility, departments. Saved per section with a toast.
import { isHalfStep, SAVE_STATUSES, TEAM_VISIBILITY, WEEK_PRESETS, isWorkWeekday, type CompanySettingsUpdateInput } from "@leave/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { settingsApi, useSettingsWrite, type CompanySettings, type DepartmentRow } from "@/common/api/settings";
import { errorMessage } from "@/common/lib/errorMessage";
import { formatDay } from "@/common/lib/format";
import { useToast } from "@/common/toast/ToastProvider";
import { cn } from "@/lib/utils";
import { Check, Field, GhostButton, inputCls, PrimaryButton, SectionTitle } from "./ui";
import { ISO_DAYS, toggleWeekday } from "./workWeek";

const LOCALES = ["fr-FR", "en-GB"] as const;

/** Only the fields that changed, so a save never overwrites a concurrent edit of another field. */
export function companyPatch(original: CompanySettings, draft: CompanySettings): CompanySettingsUpdateInput {
  const patch: Record<string, unknown> = {};
  for (const key of ["name", "workDays", "leaveYearStartMonth", "allowNegative", "negativeLimitDays", "defaultSaveStatus", "locale", "teamVisibility"] as const) {
    if (draft[key] !== original[key]) patch[key] = draft[key];
  }
  return patch as CompanySettingsUpdateInput;
}

function DepartmentLine({ dept, readOnly }: { dept: DepartmentRow; readOnly: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const write = useSettingsWrite();
  const [name, setName] = useState(dept.name);
  const [min, setMin] = useState(dept.minStaffing === null ? "" : String(dept.minStaffing));
  const [order, setOrder] = useState(String(dept.sortOrder));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setName(dept.name);
    setMin(dept.minStaffing === null ? "" : String(dept.minStaffing));
    setOrder(String(dept.sortOrder));
  }, [dept]);

  const minValue = min.trim() === "" ? null : Number(min);
  const orderValue = Number(order);
  const dirty = name !== dept.name || minValue !== dept.minStaffing || orderValue !== dept.sortOrder;
  const fail = (err: unknown) => {
    const message = errorMessage(t, err);
    setError(message);
    toast({ message, tone: "error" });
  };

  const save = async () => {
    setError(null);
    if (!name.trim() || (minValue !== null && !Number.isInteger(minValue)) || !Number.isInteger(orderValue)) return setError(t("errors.validation"));
    try {
      await write(() => settingsApi.updateDepartment(dept.id, { name, minStaffing: minValue, sortOrder: orderValue }));
      toast({ message: t("settings.departments.saved", { name }) });
    } catch (err) {
      fail(err);
    }
  };
  const remove = async () => {
    setError(null);
    try {
      await write(() => settingsApi.deleteDepartment(dept.id));
      toast({ message: t("settings.departments.deleted", { name: dept.name }) });
    } catch (err) {
      fail(err);
    }
  };

  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label={t("settings.departments.name")} value={name} onChange={(e) => setName(e.target.value)} className={cn(inputCls, "min-w-40 flex-1")} />
        <input
          aria-label={t("settings.departments.minStaffing")}
          value={min}
          inputMode="numeric"
          placeholder={t("settings.departments.minStaffingShort")}
          onChange={(e) => setMin(e.target.value)}
          className={cn(inputCls, "w-20 tabular-nums")}
        />
        <input aria-label={t("settings.departments.sortOrder")} value={order} inputMode="numeric" onChange={(e) => setOrder(e.target.value)} className={cn(inputCls, "w-16 tabular-nums")} />
        <span className="w-20 text-meta tabular-nums text-muted-foreground">{t("settings.departments.count", { count: dept.activeEmployeeCount })}</span>
        {!readOnly ? (
          <>
            <PrimaryButton disabled={!dirty} onClick={() => void save()}>
              {t("common.save")}
            </PrimaryButton>
            <GhostButton onClick={() => void remove()} aria-label={t("settings.departments.delete", { name: dept.name })}>
              {t("common.delete")}
            </GhostButton>
          </>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-meta text-status-rejected">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function Departments({ departments, readOnly }: { departments: DepartmentRow[]; readOnly: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const write = useSettingsWrite();
  const [name, setName] = useState("");
  const add = async () => {
    if (!name.trim()) return;
    try {
      const created = await write(() => settingsApi.createDepartment(name));
      toast({ message: t("settings.departments.added", { name: created.name }) });
      setName("");
    } catch (err) {
      toast({ message: errorMessage(t, err), tone: "error" });
    }
  };
  return (
    <section aria-label={t("settings.departments.title")}>
      <SectionTitle>{t("settings.departments.title")}</SectionTitle>
      <p className="mb-2 text-meta text-muted-foreground">{t("settings.departments.v2Note")}</p>
      <ul className="divide-y rounded-md border px-3">
        {departments.map((d) => (
          <DepartmentLine key={d.id} dept={d} readOnly={readOnly} />
        ))}
      </ul>
      {!readOnly ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input aria-label={t("settings.departments.newName")} placeholder={t("settings.departments.newName")} value={name} onChange={(e) => setName(e.target.value)} className={cn(inputCls, "max-w-xs")} />
          <GhostButton type="submit">{t("settings.departments.add")}</GhostButton>
        </form>
      ) : null}
    </section>
  );
}

export function CompanyTab({ company, departments, readOnly }: { company: CompanySettings; departments: DepartmentRow[]; readOnly: boolean }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const write = useSettingsWrite();
  const [draft, setDraft] = useState(company);
  const [limit, setLimit] = useState(String(company.negativeLimitDays));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDraft(company);
    setLimit(String(company.negativeLimitDays));
  }, [company]);

  const set = <K extends keyof CompanySettings>(key: K, value: CompanySettings[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const limitNumber = Number(limit.replace(",", "."));
  const limitValid = Number.isFinite(limitNumber) && limitNumber >= 0 && isHalfStep(limitNumber);
  const patch = companyPatch(company, { ...draft, negativeLimitDays: limitValid ? limitNumber : draft.negativeLimitDays });
  const dirty = Object.keys(patch).length > 0;

  const save = async () => {
    if (!limitValid) return toast({ message: t("errors.halfDayStep"), tone: "error" });
    setBusy(true);
    try {
      await write(() => settingsApi.updateCompany(patch));
      toast({ message: t("settings.company.saved") });
    } catch (err) {
      toast({ message: errorMessage(t, err), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const presets = [
    { key: "monFri", mask: WEEK_PRESETS.monFri },
    { key: "monSat", mask: WEEK_PRESETS.monSat },
    { key: "sunThu", mask: WEEK_PRESETS.sunThu },
  ] as const;

  return (
    <div className="space-y-8">
      <section aria-label={t("settings.company.title")} className="max-w-2xl space-y-4">
        <SectionTitle>{t("settings.company.title")}</SectionTitle>
        <Field label={t("settings.company.name")}>
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} className={inputCls} />
        </Field>
        <Field label={t("settings.company.country")} hint={t("settings.company.countryNote")}>
          <input value={draft.countryCode} readOnly aria-readonly="true" className={cn(inputCls, "w-24 bg-muted/50")} />
        </Field>

        <fieldset>
          <legend className="mb-1 text-meta font-medium">{t("settings.company.workWeek")}</legend>
          <div className="flex flex-wrap items-center gap-1.5">
            {ISO_DAYS.map((d) => {
              const on = isWorkWeekday(draft.workDays, d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set("workDays", toggleWeekday(draft.workDays, d))}
                  className={cn("h-8 w-12 rounded-md border text-meta max-md:h-11", on ? "border-accent bg-accent/10 font-medium" : "text-muted-foreground hover:bg-muted")}
                >
                  {formatDay(`2024-01-0${d}`, i18n.language, { weekday: "short" })}
                </button>
              );
            })}
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            {presets.map((p) => (
              <GhostButton key={p.key} onClick={() => set("workDays", p.mask)} className={cn(draft.workDays === p.mask && "border-accent")}>
                {t(`settings.company.preset.${p.key}`)}
              </GhostButton>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("settings.company.leaveYearStart")}>
            <select value={draft.leaveYearStartMonth} onChange={(e) => set("leaveYearStartMonth", Number(e.target.value))} className={inputCls}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {formatDay(`2000-${String(i + 1).padStart(2, "0")}-01`, i18n.language, { month: "long" })}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("settings.company.defaultStatus")}>
            <select value={draft.defaultSaveStatus} onChange={(e) => set("defaultSaveStatus", e.target.value as CompanySettings["defaultSaveStatus"])} className={inputCls}>
              {SAVE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid items-end gap-4 sm:grid-cols-2">
          <Check label={t("settings.company.allowNegative")} checked={draft.allowNegative} onChange={(v) => set("allowNegative", v)} />
          <Field label={t("settings.company.negativeLimit")}>
            <input
              value={limit}
              inputMode="decimal"
              disabled={!draft.allowNegative}
              aria-invalid={!limitValid}
              onChange={(e) => setLimit(e.target.value)}
              className={cn(inputCls, "tabular-nums")}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("settings.company.locale")} hint={t("settings.company.localeHint")}>
            <select value={draft.locale} onChange={(e) => set("locale", e.target.value)} className={inputCls}>
              {[...new Set<string>([...LOCALES, draft.locale])].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("settings.company.teamVisibility")} hint={t("settings.company.teamVisibilityHint")}>
            <select value={draft.teamVisibility} onChange={(e) => set("teamVisibility", e.target.value as CompanySettings["teamVisibility"])} className={inputCls}>
              {TEAM_VISIBILITY.map((v) => (
                <option key={v} value={v}>
                  {t(`settings.company.visibility.${v}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {!readOnly ? (
          <PrimaryButton disabled={!dirty || busy} onClick={() => void save()}>
            {t("common.save")}
          </PrimaryButton>
        ) : null}
      </section>

      <Departments departments={departments} readOnly={readOnly} />
    </div>
  );
}
