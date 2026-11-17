// Settings > Leave types: table of every type (inactive included), add/edit in the 480 px sheet.
// Types are never deleted, only deactivated.
import { DAY_COUNT_MODES, isHalfStep, LEAVE_TYPE_PALETTE, paletteHex, type LeaveTypeCreateInput, type PaletteKey } from "@leave/shared";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { settingsApi, useSettingsWrite, type SettingsLeaveType } from "@/common/api/settings";
import { LeaveTypeChip } from "@/common/components/LeaveTypeChip";
import { errorMessage } from "@/common/lib/errorMessage";
import { formatDays } from "@/common/lib/format";
import { useToast } from "@/common/toast/ToastProvider";
import { cn } from "@/lib/utils";
import { Sheet } from "@/ui/Sheet";
import { Check, Field, GhostButton, inputCls, PrimaryButton, SectionTitle } from "./ui";

type Draft = {
  name: string;
  color: PaletteKey;
  isPaid: boolean;
  deductsBalance: boolean;
  dayCountMode: "working" | "calendar";
  requiresAttachment: boolean;
  annualCap: string;
  defaultSaveStatus: "" | "approved" | "pending";
  sortOrder: string;
  isActive: boolean;
};

const blank = (sortOrder: number): Draft => ({
  name: "",
  color: "blue",
  isPaid: true,
  deductsBalance: true,
  dayCountMode: "working",
  requiresAttachment: false,
  annualCap: "",
  defaultSaveStatus: "",
  sortOrder: String(sortOrder),
  isActive: true,
});

const fromType = (x: SettingsLeaveType): Draft => ({
  name: x.name,
  color: x.color as PaletteKey,
  isPaid: x.isPaid,
  deductsBalance: x.deductsBalance,
  dayCountMode: x.dayCountMode,
  requiresAttachment: x.requiresAttachment,
  annualCap: x.annualCapDays === null ? "" : String(x.annualCapDays),
  defaultSaveStatus: (x.defaultSaveStatus ?? "") as Draft["defaultSaveStatus"],
  sortOrder: String(x.sortOrder),
  isActive: x.isActive,
});

/** Parse the draft into the API body, or return an i18n key for the first problem. */
export function draftToInput(d: Draft): { ok: true; input: LeaveTypeCreateInput } | { ok: false; error: string } {
  if (!d.name.trim()) return { ok: false, error: "errors.required" };
  const cap = d.annualCap.trim() === "" ? null : Number(d.annualCap.replace(",", "."));
  if (cap !== null && (!Number.isFinite(cap) || cap < 0 || !isHalfStep(cap))) return { ok: false, error: "errors.halfDayStep" };
  const order = Number(d.sortOrder);
  if (!Number.isInteger(order) || order < 0) return { ok: false, error: "errors.validation" };
  return {
    ok: true,
    input: {
      name: d.name.trim(),
      color: d.color,
      isPaid: d.isPaid,
      deductsBalance: d.deductsBalance,
      dayCountMode: d.dayCountMode,
      requiresAttachment: d.requiresAttachment,
      annualCapDays: cap,
      defaultSaveStatus: d.defaultSaveStatus === "" ? null : d.defaultSaveStatus,
      sortOrder: order,
      isActive: d.isActive,
    },
  };
}

function LeaveTypeSheet({ type, nextOrder, onClose }: { type: SettingsLeaveType | null; nextOrder: number; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const write = useSettingsWrite();
  const [d, setD] = useState<Draft>(() => (type ? fromType(type) : blank(nextOrder)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = async () => {
    const parsed = draftToInput(d);
    if (!parsed.ok) return setError(t(parsed.error));
    setError(null);
    setBusy(true);
    try {
      await write(() => (type ? settingsApi.updateLeaveType(type.id, parsed.input) : settingsApi.createLeaveType(parsed.input)));
      toast({ message: t(type ? "settings.types.saved" : "settings.types.created", { name: parsed.input.name }) });
      onClose();
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={t(type ? "settings.types.edit" : "settings.types.new")}
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          {error ? (
            <p role="alert" className="min-w-0 flex-1 text-meta text-status-rejected">
              {error}
            </p>
          ) : (
            <span className="flex-1" />
          )}
          <GhostButton onClick={onClose}>{t("common.cancel")}</GhostButton>
          <PrimaryButton disabled={busy} onClick={() => void save()}>
            {t("common.save")}
          </PrimaryButton>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        <Field label={t("settings.types.name")}>
          <input data-autofocus value={d.name} onChange={(e) => set("name", e.target.value)} className={inputCls} />
        </Field>
        <fieldset>
          <legend className="mb-1 text-meta font-medium">{t("settings.types.color")}</legend>
          <div role="radiogroup" className="flex flex-wrap gap-2">
            {LEAVE_TYPE_PALETTE.map((c) => (
              <button
                key={c.key}
                type="button"
                role="radio"
                aria-checked={d.color === c.key}
                aria-label={t(`settings.types.palette.${c.key}`)}
                title={t(`settings.types.palette.${c.key}`)}
                onClick={() => set("color", c.key)}
                style={{ backgroundColor: paletteHex(c.key) }}
                className={cn("h-8 w-8 rounded-md border-2 border-transparent max-md:h-11 max-md:w-11", d.color === c.key && "ring-2 ring-foreground ring-offset-2")}
              />
            ))}
          </div>
        </fieldset>
        <div className="space-y-1">
          <Check label={t("settings.types.paid")} checked={d.isPaid} onChange={(v) => set("isPaid", v)} />
          <Check label={t("settings.types.deducts")} checked={d.deductsBalance} onChange={(v) => set("deductsBalance", v)} />
          <Check label={t("settings.types.requiresAttachment")} checked={d.requiresAttachment} onChange={(v) => set("requiresAttachment", v)} />
        </div>
        <Field label={t("settings.types.dayCount")}>
          <select value={d.dayCountMode} onChange={(e) => set("dayCountMode", e.target.value as Draft["dayCountMode"])} className={inputCls}>
            {DAY_COUNT_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`settings.types.mode.${m}`)}
              </option>
            ))}
          </select>
        </Field>
        <p className="-mt-2 text-meta text-muted-foreground">{t("settings.types.ledgerNote")}</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("settings.types.annualCap")}>
            <input value={d.annualCap} inputMode="decimal" onChange={(e) => set("annualCap", e.target.value)} className={cn(inputCls, "tabular-nums")} />
          </Field>
          <Field label={t("settings.types.sortOrder")}>
            <input value={d.sortOrder} inputMode="numeric" onChange={(e) => set("sortOrder", e.target.value)} className={cn(inputCls, "tabular-nums")} />
          </Field>
        </div>
        <Field label={t("settings.types.defaultStatus")}>
          <select value={d.defaultSaveStatus} onChange={(e) => set("defaultSaveStatus", e.target.value as Draft["defaultSaveStatus"])} className={inputCls}>
            <option value="">{t("settings.types.inherit")}</option>
            <option value="approved">{t("status.approved")}</option>
            <option value="pending">{t("status.pending")}</option>
          </select>
        </Field>
        <Check label={t("settings.types.active")} hint={t("settings.types.activeHint")} checked={d.isActive} onChange={(v) => set("isActive", v)} />
      </div>
    </Sheet>
  );
}

export function LeaveTypesTab({ leaveTypes, readOnly }: { leaveTypes: SettingsLeaveType[]; readOnly: boolean }) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState<SettingsLeaveType | "new" | null>(null);
  const yes = (v: boolean) => (v ? t("common.yes") : t("common.no"));
  const th = "h-9 whitespace-nowrap px-3 text-start font-medium";
  const nextOrder = leaveTypes.reduce((m, x) => Math.max(m, x.sortOrder), 0) + 10;

  return (
    <section aria-label={t("settings.tabs.types")}>
      <div className="mb-3 flex items-center gap-3">
        <SectionTitle>{t("settings.tabs.types")}</SectionTitle>
        {!readOnly ? (
          <GhostButton className="ms-auto inline-flex items-center gap-1.5" onClick={() => setEditing("new")}>
            <Plus size={14} aria-hidden="true" />
            {t("settings.types.add")}
          </GhostButton>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[760px] text-table">
          <thead className="text-meta text-muted-foreground shadow-[0_1px_0_var(--border)]">
            <tr>
              <th scope="col" className={th}>{t("settings.types.name")}</th>
              <th scope="col" className={th}>{t("settings.types.paid")}</th>
              <th scope="col" className={th}>{t("settings.types.deductsShort")}</th>
              <th scope="col" className={th}>{t("settings.types.dayCount")}</th>
              <th scope="col" className={cn(th, "text-end")}>{t("settings.types.annualCap")}</th>
              <th scope="col" className={th}>{t("settings.types.defaultStatus")}</th>
              <th scope="col" className={th}>{t("settings.types.status")}</th>
            </tr>
          </thead>
          <tbody>
            {leaveTypes.map((x) => (
              <tr key={x.id} className={cn("h-9 border-b last:border-b-0", !x.isActive && "text-muted-foreground")}>
                <td className="px-3">
                  {readOnly ? (
                    <LeaveTypeChip name={x.name} color={x.color} />
                  ) : (
                    <button type="button" onClick={() => setEditing(x)} aria-label={t("settings.types.editNamed", { name: x.name })} className="max-w-full">
                      <LeaveTypeChip name={x.name} color={x.color} />
                    </button>
                  )}
                </td>
                <td className="px-3">{yes(x.isPaid)}</td>
                <td className="px-3">{yes(x.deductsBalance)}</td>
                <td className="px-3">{t(`settings.types.mode.${x.dayCountMode}`)}</td>
                <td className="px-3 text-end tabular-nums">{x.annualCapDays === null ? "—" : formatDays(x.annualCapDays, i18n.language)}</td>
                <td className="px-3">{x.defaultSaveStatus ? t(`status.${x.defaultSaveStatus}`) : t("settings.types.inherit")}</td>
                <td className="px-3 text-meta">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn("h-1.5 w-1.5 rounded-full", x.isActive ? "bg-status-approved" : "bg-status-cancelled")} aria-hidden="true" />
                    {t(x.isActive ? "settings.types.active" : "settings.types.inactive")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing ? <LeaveTypeSheet type={editing === "new" ? null : editing} nextOrder={nextOrder} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}
