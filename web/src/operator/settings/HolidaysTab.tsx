// Settings > Public holidays: year switcher, table, add / edit / delete / confirm. Any change that
// alters leave day counts opens the affected-leaves dialog (rule 8: recalculation is confirmed).
import { OPERATOR_HOLIDAY_SOURCES } from "@leave/shared";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { settingsApi, useHolidays, useSettingsWrite, type AffectedLeave, type HolidayRow } from "@/common/api/settings";
import { EmptyState } from "@/common/components/EmptyState";
import { todayIso } from "@/common/lib/date";
import { errorMessage } from "@/common/lib/errorMessage";
import { formatDay } from "@/common/lib/format";
import { useToast } from "@/common/toast/ToastProvider";
import { cn } from "@/lib/utils";
import { ConfirmDialog, Dialog } from "@/ui/Dialog";
import { SkeletonRows } from "@/ui/Skeleton";
import { AffectedLeavesDialog } from "./AffectedLeavesDialog";
import { Check, Field, GhostButton, inputCls, PrimaryButton, SectionTitle } from "./ui";

type Draft = { date: string; name: string; isHalfDay: boolean; isConfirmed: boolean; source: "custom" | "closure" };

function HolidayForm({ initial, onSave, onClose }: { initial: HolidayRow | null; onSave: (d: Draft) => Promise<string | null>; onClose: () => void }) {
  const { t } = useTranslation();
  const [d, setD] = useState<Draft>({
    date: initial?.date ?? `${todayIso().slice(0, 4)}-01-01`,
    name: initial?.name ?? "",
    isHalfDay: initial?.isHalfDay ?? false,
    isConfirmed: initial?.isConfirmed ?? true,
    source: initial?.source === "closure" ? "closure" : "custom",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const submit = async () => {
    if (!d.name.trim() || !d.date) return setError(t("errors.required"));
    setBusy(true);
    setError(await onSave(d));
    setBusy(false);
  };

  return (
    <Dialog
      title={t(initial ? "settings.holidays.edit" : "settings.holidays.new")}
      onClose={onClose}
      actions={
        <>
          <GhostButton onClick={onClose}>{t("common.cancel")}</GhostButton>
          <PrimaryButton disabled={busy} onClick={() => void submit()}>
            {t("common.save")}
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t("settings.holidays.col.date")}>
          <input type="date" data-autofocus value={d.date} onChange={(e) => set("date", e.target.value)} className={cn(inputCls, "tabular-nums")} />
        </Field>
        <Field label={t("settings.holidays.col.name")}>
          <input value={d.name} onChange={(e) => set("name", e.target.value)} className={inputCls} />
        </Field>
        {!initial ? (
          <Field label={t("settings.holidays.col.source")}>
            <select value={d.source} onChange={(e) => set("source", e.target.value as Draft["source"])} className={inputCls}>
              {OPERATOR_HOLIDAY_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {t(`settings.holidays.source.${s}`)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Check label={t("settings.holidays.halfDay")} checked={d.isHalfDay} onChange={(v) => set("isHalfDay", v)} />
        <Check label={t("settings.holidays.confirmed")} checked={d.isConfirmed} onChange={(v) => set("isConfirmed", v)} />
        {error ? (
          <p role="alert" className="text-status-rejected">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

export function HolidaysTab({ readOnly }: { readOnly: boolean }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const write = useSettingsWrite();
  const [year, setYear] = useState(() => Number(todayIso().slice(0, 4)));
  const holidays = useHolidays(year);
  const [form, setForm] = useState<HolidayRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<HolidayRow | null>(null);
  const [affected, setAffected] = useState<AffectedLeave[]>([]);

  const afterWrite = (leaves: AffectedLeave[]) => {
    if (leaves.length > 0) setAffected(leaves);
  };

  const save = async (d: Draft): Promise<string | null> => {
    try {
      const res = form === "new" || form === null ? await write(() => settingsApi.createHoliday(d)) : await write(() => settingsApi.updateHoliday(form.id, { date: d.date, name: d.name, isHalfDay: d.isHalfDay, isConfirmed: d.isConfirmed }));
      toast({ message: t("settings.holidays.saved", { name: res.holiday.name }) });
      setForm(null);
      afterWrite(res.affectedLeaves);
      return null;
    } catch (err) {
      return errorMessage(t, err);
    }
  };

  const confirmDate = async (h: HolidayRow) => {
    try {
      const res = await write(() => settingsApi.updateHoliday(h.id, { isConfirmed: true }));
      toast({ message: t("settings.holidays.confirmedToast", { name: h.name }) });
      afterWrite(res.affectedLeaves);
    } catch (err) {
      toast({ message: errorMessage(t, err), tone: "error" });
    }
  };

  const remove = async (h: HolidayRow) => {
    setDeleting(null);
    try {
      const res = await write(() => settingsApi.deleteHoliday(h.id));
      toast({ message: t("settings.holidays.deleted", { name: h.name }) });
      afterWrite(res.affectedLeaves);
    } catch (err) {
      toast({ message: errorMessage(t, err), tone: "error" });
    }
  };

  const th = "h-9 whitespace-nowrap px-3 text-start font-medium";
  return (
    <section aria-label={t("settings.tabs.holidays")}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SectionTitle>{t("settings.tabs.holidays")}</SectionTitle>
        <div className="inline-flex items-center gap-1" role="group" aria-label={t("settings.holidays.year")}>
          <button type="button" onClick={() => setYear((y) => y - 1)} aria-label={t("period.previous")} className="grid h-8 w-8 place-items-center rounded-md hover:bg-muted max-md:h-11 max-md:w-11">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span className="w-12 text-center font-medium tabular-nums" aria-live="polite">
            {year}
          </span>
          <button type="button" onClick={() => setYear((y) => y + 1)} aria-label={t("period.next")} className="grid h-8 w-8 place-items-center rounded-md hover:bg-muted max-md:h-11 max-md:w-11">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
        {!readOnly ? (
          <GhostButton className="ms-auto inline-flex items-center gap-1.5" onClick={() => setForm("new")}>
            <Plus size={14} aria-hidden="true" />
            {t("settings.holidays.add")}
          </GhostButton>
        ) : null}
      </div>
      {holidays.isPending ? (
        <SkeletonRows label={t("common.loading")} cols={5} rows={5} />
      ) : holidays.isError ? (
        <EmptyState message={errorMessage(t, holidays.error)} actionLabel={t("common.retry")} onAction={() => void holidays.refetch()} />
      ) : holidays.data.length === 0 ? (
        <EmptyState message={t("settings.holidays.empty", { year })} />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[680px] text-table">
            <thead className="text-meta text-muted-foreground shadow-[0_1px_0_var(--border)]">
              <tr>
                <th scope="col" className={th}>{t("settings.holidays.col.date")}</th>
                <th scope="col" className={th}>{t("settings.holidays.col.name")}</th>
                <th scope="col" className={th}>{t("settings.holidays.col.half")}</th>
                <th scope="col" className={th}>{t("settings.holidays.col.confirmed")}</th>
                <th scope="col" className={th}>{t("settings.holidays.col.source")}</th>
                {!readOnly ? <th scope="col" className="h-9 w-40 px-3"><span className="sr-only">{t("employees.col.actions")}</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {holidays.data.map((h) => (
                <tr key={h.id} className="h-9 border-b last:border-b-0">
                  <td className="whitespace-nowrap px-3 tabular-nums">{formatDay(h.date, i18n.language, { weekday: "short", day: "numeric", month: "short" })}</td>
                  <td className="px-3">{h.name}</td>
                  <td className="px-3">{h.isHalfDay ? t("common.yes") : t("common.no")}</td>
                  <td className="px-3">
                    {h.isConfirmed ? (
                      <span className="text-meta text-muted-foreground">{t("common.yes")}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-status-pending px-2 text-meta text-status-pending">{t("settings.holidays.toConfirm")}</span>
                    )}
                  </td>
                  <td className="px-3 text-meta">{t(`settings.holidays.source.${h.source}`, { defaultValue: h.source })}</td>
                  {!readOnly ? (
                    <td className="px-2 text-end">
                      {!h.isConfirmed ? (
                        <button type="button" onClick={() => void confirmDate(h)} className="h-8 rounded px-2 text-accent hover:bg-muted max-md:h-11">
                          {t("settings.holidays.confirm")}
                        </button>
                      ) : null}
                      <button type="button" onClick={() => setForm(h)} aria-label={t("settings.holidays.editNamed", { name: h.name })} className="h-8 rounded px-2 hover:bg-muted max-md:h-11">
                        {t("settings.holidays.editShort")}
                      </button>
                      <button type="button" onClick={() => setDeleting(h)} aria-label={t("settings.holidays.deleteNamed", { name: h.name })} className="h-8 rounded px-2 text-status-rejected hover:bg-muted max-md:h-11">
                        {t("common.delete")}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form ? <HolidayForm initial={form === "new" ? null : form} onSave={save} onClose={() => setForm(null)} /> : null}
      {deleting ? (
        <ConfirmDialog
          title={t("settings.holidays.deleteTitle", { name: deleting.name })}
          message={t("settings.holidays.deleteMessage")}
          confirmLabel={t("common.delete")}
          destructive
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove(deleting)}
        />
      ) : null}
      {affected.length > 0 ? <AffectedLeavesDialog leaves={affected} onClose={() => setAffected([])} /> : null}
    </section>
  );
}
