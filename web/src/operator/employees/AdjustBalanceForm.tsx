// Manual balance adjustment (spec 1.1): +/- days in 0.5 steps, leave type, effective date and a
// mandatory note. Adds a ledger row; it never overwrites a number.
import { adjustmentSchema, type AdjustmentInput } from "@leave/shared";
import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LeaveTypeRef } from "@/common/api/reference";
import { todayIso } from "@/common/lib/date";
import { errorMessage } from "@/common/lib/errorMessage";

export function AdjustBalanceForm({ leaveTypes, onSubmit }: { leaveTypes: LeaveTypeRef[]; onSubmit: (input: AdjustmentInput) => Promise<void> }) {
  const { t } = useTranslation();
  const [typeId, setTypeId] = useState(leaveTypes[0]?.id ?? "");
  const [days, setDays] = useState("");
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = Number(days.replace(",", "."));
  const step = (delta: number) => setDays(String((Number.isFinite(parsed) && days !== "" ? parsed : 0) + delta));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const input = { leaveTypeId: typeId, days: parsed, effectiveDate: date, note };
    const result = adjustmentSchema.safeParse(input);
    if (!result.success) return setError(result.error.issues.map((i) => t(i.message)).join(" "));
    setBusy(true);
    try {
      await onSubmit(result.data);
      setDays("");
      setNote("");
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  const field = "h-8 w-full rounded-md border bg-background px-2 max-md:h-11";
  return (
    <form onSubmit={submit} className="space-y-2" aria-label={t("ledger.adjust")}>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-0.5">
          <span className="text-meta text-muted-foreground">{t("ledger.type")}</span>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className={field}>
            {leaveTypes.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-0.5">
          <span className="text-meta text-muted-foreground">{t("ledger.effectiveDate")}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${field} tabular-nums`} />
        </label>
      </div>
      <div className="space-y-0.5">
        <span className="text-meta text-muted-foreground">{t("ledger.days")}</span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => step(-0.5)} aria-label={t("ledger.minusHalf")} className="grid h-8 w-8 place-items-center rounded-md border hover:bg-muted max-md:h-11 max-md:w-11">
            <Minus size={14} aria-hidden="true" />
          </button>
          <input inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} aria-label={t("ledger.days")} placeholder="+1.5" className={`${field} text-center tabular-nums`} />
          <button type="button" onClick={() => step(0.5)} aria-label={t("ledger.plusHalf")} className="grid h-8 w-8 place-items-center rounded-md border hover:bg-muted max-md:h-11 max-md:w-11">
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <label className="block space-y-0.5">
        <span className="text-meta text-muted-foreground">{t("ledger.note")}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} required className={field} />
      </label>
      {error ? (
        <p role="alert" className="text-status-rejected">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className="h-8 rounded-md bg-accent px-3 text-accent-foreground disabled:opacity-50 max-md:h-11">
        {t("ledger.apply")}
      </button>
    </form>
  );
}
