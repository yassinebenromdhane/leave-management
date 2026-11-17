// Settings > Accrual: per-type policy (every rule change asks "from today / from leave-year start")
// and the manual "Run accrual" panel (preview first, then a confirmed run; MVP, spec 3.1).
import { ACCRUAL_MODES, isHalfStep, type AccrualMode, type LeavePolicyInput } from "@leave/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { settingsApi, useSettingsWrite, type AccrualPreview, type PolicyGroup, type SettingsLeaveType } from "@/common/api/settings";
import { LeaveTypeChip } from "@/common/components/LeaveTypeChip";
import { todayIso } from "@/common/lib/date";
import { errorMessage } from "@/common/lib/errorMessage";
import { formatDay, formatDays } from "@/common/lib/format";
import { useToast } from "@/common/toast/ToastProvider";
import { cn } from "@/lib/utils";
import { ConfirmDialog, Dialog } from "@/ui/Dialog";
import { Check, Field, GhostButton, inputCls, PrimaryButton, SectionTitle } from "./ui";

type PolicyDraft = { accrualMode: AccrualMode; rate: string; prorate: boolean; cap: string; expiry: string };
const MONTH_DAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

const draftOf = (p: PolicyGroup["current"]): PolicyDraft => ({
  accrualMode: p?.accrualMode ?? "monthly",
  rate: p ? String(p.rateDays) : "",
  prorate: p?.prorateHireMonth ?? true,
  cap: p?.carryoverCapDays == null ? "" : String(p.carryoverCapDays),
  expiry: p?.carryoverExpiryMonthDay ?? "",
});

/** Draft -> API body (without applyFrom), or an i18n key naming the first problem. */
export function policyFromDraft(d: PolicyDraft): { ok: true; input: Omit<LeavePolicyInput, "applyFrom"> } | { ok: false; error: string } {
  const rate = Number(d.rate.replace(",", "."));
  if (d.rate.trim() === "" || !Number.isFinite(rate) || rate < 0 || !isHalfStep(rate)) return { ok: false, error: "errors.halfDayStep" };
  const cap = d.cap.trim() === "" ? null : Number(d.cap.replace(",", "."));
  if (cap !== null && (!Number.isFinite(cap) || cap < 0 || !isHalfStep(cap))) return { ok: false, error: "errors.halfDayStep" };
  const expiry = d.expiry.trim() === "" ? null : d.expiry.trim();
  if (expiry !== null && !MONTH_DAY_RE.test(expiry)) return { ok: false, error: "settings.errors.monthDay" };
  return { ok: true, input: { accrualMode: d.accrualMode, rateDays: rate, prorateHireMonth: d.prorate, carryoverCapDays: cap, carryoverExpiryMonthDay: expiry } };
}

function PolicyCard({ type, group, readOnly }: { type: SettingsLeaveType; group: PolicyGroup | undefined; readOnly: boolean }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const write = useSettingsWrite();
  const [d, setD] = useState(() => draftOf(group?.current ?? null));
  const [ask, setAsk] = useState<Omit<LeavePolicyInput, "applyFrom"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setD(draftOf(group?.current ?? null)), [group]);
  const set = <K extends keyof PolicyDraft>(k: K, v: PolicyDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  const apply = async (applyFrom: LeavePolicyInput["applyFrom"]) => {
    if (!ask) return;
    const input = { ...ask, applyFrom };
    setAsk(null);
    try {
      await write(() => settingsApi.setPolicy(type.id, input));
      toast({ message: t("settings.accrual.saved", { name: type.name }) });
    } catch (err) {
      toast({ message: errorMessage(t, err), tone: "error" });
    }
  };
  const submit = () => {
    const parsed = policyFromDraft(d);
    if (!parsed.ok) return setError(t(parsed.error));
    setError(null);
    setAsk(parsed.input);
  };

  const history = group?.history ?? [];
  return (
    <section className="rounded-lg border p-4" aria-label={type.name}>
      <header className="mb-3 flex items-center gap-2">
        <LeaveTypeChip name={type.name} color={type.color} />
        {!group?.current ? <span className="text-meta text-muted-foreground">{t("settings.accrual.noPolicy")}</span> : null}
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("settings.accrual.mode")}>
          <select value={d.accrualMode} onChange={(e) => set("accrualMode", e.target.value as AccrualMode)} className={inputCls}>
            {ACCRUAL_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`settings.accrual.modes.${m}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t(d.accrualMode === "monthly" ? "settings.accrual.ratePerMonth" : "settings.accrual.ratePerYear")}>
          <input value={d.rate} inputMode="decimal" onChange={(e) => set("rate", e.target.value)} className={cn(inputCls, "tabular-nums")} />
        </Field>
        <Field label={t("settings.accrual.carryoverCap")}>
          <input value={d.cap} inputMode="decimal" onChange={(e) => set("cap", e.target.value)} className={cn(inputCls, "tabular-nums")} />
        </Field>
        <Field label={t("settings.accrual.carryoverExpiry")}>
          <input value={d.expiry} placeholder="MM-DD" onChange={(e) => set("expiry", e.target.value)} className={cn(inputCls, "tabular-nums")} />
        </Field>
      </div>
      <div className="mt-3">
        <Check label={t("settings.accrual.prorate")} checked={d.prorate} onChange={(v) => set("prorate", v)} />
      </div>
      <p className="mt-1 text-meta text-muted-foreground">{t("settings.accrual.carryoverNote")}</p>
      {error ? (
        <p role="alert" className="mt-2 text-meta text-status-rejected">
          {error}
        </p>
      ) : null}
      {!readOnly ? (
        <div className="mt-3">
          <PrimaryButton onClick={submit}>{t("settings.accrual.savePolicy")}</PrimaryButton>
        </div>
      ) : null}
      {history.length > 1 ? (
        <details className="mt-3 text-meta">
          <summary className="cursor-pointer text-muted-foreground">{t("settings.accrual.history", { count: history.length })}</summary>
          <ul className="mt-1 space-y-0.5 tabular-nums">
            {[...history].reverse().map((p) => (
              <li key={p.id}>
                {formatDay(p.effectiveFrom, i18n.language, { day: "numeric", month: "short", year: "numeric" })}: {t(`settings.accrual.modes.${p.accrualMode}`)} · {formatDays(p.rateDays, i18n.language)}
                {p.carryoverCapDays !== null ? ` · ${t("settings.accrual.capShort", { days: formatDays(p.carryoverCapDays, i18n.language) })}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {ask ? (
        <Dialog
          title={t("settings.accrual.applyTitle")}
          onClose={() => setAsk(null)}
          actions={
            <>
              <GhostButton onClick={() => setAsk(null)} data-autofocus>
                {t("common.cancel")}
              </GhostButton>
              <GhostButton onClick={() => void apply("leaveYearStart")}>{t("settings.accrual.applyYearStart")}</GhostButton>
              <PrimaryButton onClick={() => void apply("today")}>{t("settings.accrual.applyToday")}</PrimaryButton>
            </>
          }
        >
          <p className="text-muted-foreground">{t("settings.accrual.applyMessage", { name: type.name })}</p>
        </Dialog>
      ) : null}
    </section>
  );
}

/** Pure: may the month be accrued? Future months are refused by the server too (422). */
export const isFutureMonth = (period: string, today: string): boolean => period > today.slice(0, 7);

function RunAccrual({ readOnly }: { readOnly: boolean }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const write = useSettingsWrite();
  const currentMonth = todayIso().slice(0, 7);
  const [period, setPeriod] = useState(currentMonth);
  const [preview, setPreview] = useState<AccrualPreview | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const monthLabel = period ? formatDay(`${period}-01`, i18n.language, { month: "long", year: "numeric" }) : "";
  const invalid = !/^\d{4}-\d{2}$/.test(period) || isFutureMonth(period, todayIso());

  const doPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await settingsApi.previewAccrual(period));
    } catch (err) {
      setPreview(null);
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };
  const doRun = async () => {
    setConfirm(false);
    setBusy(true);
    try {
      const res = await write(() => settingsApi.runAccrual(period));
      toast({ message: t("settings.accrual.ran", { created: res.created, skipped: res.skipped }) });
      setPreview(null);
    } catch (err) {
      toast({ message: errorMessage(t, err), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border p-4" aria-label={t("settings.accrual.runTitle")}>
      <SectionTitle>{t("settings.accrual.runTitle")}</SectionTitle>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("settings.accrual.month")}>
          <input
            type="month"
            value={period}
            max={currentMonth}
            onChange={(e) => {
              setPeriod(e.target.value);
              setPreview(null);
              setError(null);
            }}
            className={cn(inputCls, "w-44 tabular-nums")}
          />
        </Field>
        {!readOnly ? (
          <GhostButton disabled={invalid || busy} onClick={() => void doPreview()}>
            {t("settings.accrual.preview")}
          </GhostButton>
        ) : null}
      </div>
      <p className="mt-2 text-meta text-muted-foreground">{t("settings.accrual.roundingNote")}</p>
      {error ? (
        <p role="alert" className="mt-2 text-status-rejected">
          {error}
        </p>
      ) : null}
      {preview ? (
        <div className="mt-4">
          <p className="mb-2 tabular-nums" data-testid="accrual-totals">
            {t("settings.accrual.totals", { toCreate: preview.totals.toCreate, alreadyDone: preview.totals.alreadyDone, employees: preview.totals.employees, days: formatDays(preview.totals.days, i18n.language) })}
          </p>
          {preview.rows.length > 0 ? (
            <div className="max-h-72 overflow-auto rounded-md border">
              <table className="w-full text-table">
                <thead className="sticky top-0 bg-background text-meta text-muted-foreground shadow-[0_1px_0_var(--border)]">
                  <tr>
                    <th scope="col" className="h-9 px-3 text-start font-medium">{t("settings.accrual.col.employee")}</th>
                    <th scope="col" className="h-9 px-3 text-start font-medium">{t("settings.accrual.col.type")}</th>
                    <th scope="col" className="h-9 px-3 text-end font-medium">{t("settings.accrual.col.days")}</th>
                    <th scope="col" className="h-9 px-3 text-start font-medium">{t("settings.accrual.col.state")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={`${r.employeeId}-${r.leaveTypeId}`} className={cn("h-9 border-b", r.alreadyDone && "text-muted-foreground")}>
                      <td className="px-3">{r.employeeName}</td>
                      <td className="px-3">{r.leaveTypeName}</td>
                      <td className="px-3 text-end tabular-nums">{formatDays(r.days, i18n.language, true)}</td>
                      <td className="px-3 text-meta">{t(r.alreadyDone ? "settings.accrual.alreadyDone" : "settings.accrual.toCreate")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {!readOnly ? (
            <div className="mt-3">
              <PrimaryButton disabled={busy || preview.totals.toCreate === 0} onClick={() => setConfirm(true)}>
                {t("settings.accrual.run", { month: monthLabel })}
              </PrimaryButton>
            </div>
          ) : null}
        </div>
      ) : null}
      {confirm ? (
        <ConfirmDialog
          title={t("settings.accrual.confirmTitle", { month: monthLabel })}
          message={t("settings.accrual.confirmMessage", { count: preview?.totals.toCreate ?? 0 })}
          confirmLabel={t("settings.accrual.run", { month: monthLabel })}
          onCancel={() => setConfirm(false)}
          onConfirm={() => void doRun()}
        />
      ) : null}
    </section>
  );
}

export function AccrualTab({ leaveTypes, policies, readOnly }: { leaveTypes: SettingsLeaveType[]; policies: PolicyGroup[]; readOnly: boolean }) {
  const { t } = useTranslation();
  const deducting = leaveTypes.filter((x) => x.deductsBalance);
  return (
    <div className="max-w-5xl space-y-6">
      <section aria-label={t("settings.tabs.accrual")} className="space-y-3">
        <SectionTitle>{t("settings.accrual.policies")}</SectionTitle>
        {deducting.map((x) => (
          <PolicyCard key={x.id} type={x} group={policies.find((p) => p.leaveTypeId === x.id)} readOnly={readOnly} />
        ))}
      </section>
      <RunAccrual readOnly={readOnly} />
    </div>
  );
}
