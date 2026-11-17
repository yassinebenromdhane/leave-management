// Request sheet (spec 1.7, 2.5): full-height bottom sheet, two taps pick the range, live count from
// @leave/shared, server preview for balance / conflicts / team. Target: submitted in under 15 s.
import {
  isValidHalfCombination,
  isWorkWeekday,
  isoWeekday,
  portalLeaveSubmitSchema,
  portalSubmitVerdict,
  workingDays,
  type ConflictResult,
  type HalfDay,
  type PortalLeaveSubmitInput,
} from "@leave/shared";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/common/api/http";
import { usePortalPreview, type PortalReference } from "@/common/api/portal";
import { AttachmentDrop } from "@/common/components/AttachmentDrop";
import { BalancePreview } from "@/common/components/BalancePreview";
import { ConflictStrip } from "@/common/components/ConflictStrip";
import { DateRangePicker } from "@/common/components/DateRangePicker";
import { DaysCountedLine } from "@/common/components/DaysCountedLine";
import { HalfDayToggle, normalizeHalves } from "@/common/components/HalfDayToggle";
import { LeaveTypeChip } from "@/common/components/LeaveTypeChip";
import { useDebounced } from "@/common/hooks/useDebounced";
import { todayIso } from "@/common/lib/date";
import { errorMessage } from "@/common/lib/errorMessage";
import { Sheet } from "@/ui/Sheet";
import { TeamStrip, type TeamCount } from "./components/TeamStrip";
import { usePortalActions } from "./usePortalActions";

const defaultType = (ref: PortalReference) => (ref.leaveTypes.find((x) => x.code === "paid") ?? ref.leaveTypes[0])?.id ?? "";

export default function RequestSheet({ reference, onClose }: { reference: PortalReference; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const today = todayIso();
  const actions = usePortalActions();

  const [typeId, setTypeId] = useState(() => defaultType(reference));
  const [range, setRange] = useState({ start: "", end: "" });
  const [halves, setHalves] = useState<{ startHalf: HalfDay; endHalf: HalfDay }>({ startHalf: "full", endHalf: "full" });
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [ack, setAck] = useState(false);
  const [serverNeedsAck, setServerNeedsAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const type = reference.leaveTypes.find((x) => x.id === typeId);
  const { holidays, workDays } = reference;

  // ---- live count: the shared rule, same inputs as the server ----
  const span = { startDate: range.start, endDate: range.end, startHalf: halves.startHalf, endHalf: halves.endHalf };
  const halfValid = range.start !== "" && range.end !== "" && isValidHalfCombination(span);
  const count = useMemo(() => {
    if (!halfValid || !type) return null;
    try {
      return workingDays({ ...span, mode: type.dayCountMode, workDays, holidays });
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [halfValid, type, range.start, range.end, halves.startHalf, halves.endHalf, workDays, holidays]);

  // ---- server preview (balance, conflicts, team), debounced ----
  const previewKey =
    type && halfValid ? JSON.stringify({ leaveTypeId: type.id, ...span, hasAttachment: file !== null }) : null;
  const debouncedKey = useDebounced(previewKey, 250);
  const preview = usePortalPreview(debouncedKey ? JSON.parse(debouncedKey) : null);
  const fresh = preview.data !== undefined && !preview.isPlaceholderData && debouncedKey === previewKey;
  const conflicts: ConflictResult = fresh ? (preview.data!.conflicts as ConflictResult) : { blocking: [], warnings: [] };

  const colleagues = conflicts.warnings.find((w) => w.code === "conflicts.colleaguesOff");
  const certificateExpected = conflicts.warnings.some((w) => w.code === "conflicts.attachmentMissing");
  // Colleagues and the certificate note get their own, friendlier lines below.
  const shownWarnings = conflicts.warnings.filter((w) => w.code !== "conflicts.colleaguesOff" && w.code !== "conflicts.attachmentMissing");
  const teamCounts: TeamCount = colleagues
    ? {
        count: Number(colleagues.params?.count ?? 0),
        size: Number(colleagues.params?.size ?? 0),
        department: String(colleagues.params?.department ?? ""),
      }
    : null;

  // The shared verdict: blocking issues block; an allowed negative balance needs the tick.
  const verdict = portalSubmitVerdict(conflicts, ack);
  const asked = portalSubmitVerdict(conflicts, false);
  const needsAck = serverNeedsAck || (!asked.ok && asked.reason === "acknowledgeNegative");
  const zeroDays = count !== null && count.days === 0;
  const canSubmit = halfValid && type !== undefined && !zeroDays && verdict.ok && (!serverNeedsAck || ack) && !submitting;

  const pick = (start: string, end: string) => {
    setRange({ start, end });
    setHalves((h) => normalizeHalves(start, end, h.startHalf, h.endHalf));
    setError(null);
  };
  const single = range.start !== "" && range.start === range.end;
  const attachVisible = attachOpen || Boolean(type?.requiresAttachment) || file !== null;

  async function submit() {
    if (!canSubmit || !type) return;
    const payload: PortalLeaveSubmitInput = {
      leaveTypeId: type.id,
      startDate: range.start,
      endDate: range.end,
      startHalf: halves.startHalf,
      endHalf: halves.endHalf,
      note: note.trim() || undefined,
      acknowledgeNegative: needsAck && ack,
    };
    const parsed = portalLeaveSubmitSchema.safeParse(payload);
    if (!parsed.success) return setError(parsed.error.issues.map((i) => t(i.message)).join(" "));
    setSubmitting(true);
    setError(null);
    try {
      await actions.submit(payload, file, type.name);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "portal.errors.acknowledgeNegative") setServerNeedsAck(true);
      setError(errorMessage(t, err));
      setSubmitting(false);
    }
  }

  return (
    <Sheet
      title={t("portal.request.title")}
      onClose={onClose}
      footer={
        <div className="space-y-2 pb-[env(safe-area-inset-bottom)]">
          {error ? (
            <p role="alert" className="rounded-md border border-status-rejected/40 bg-status-rejected/5 px-3 py-2 text-status-rejected">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="h-12 w-full rounded-md bg-accent text-[15px] font-medium text-accent-foreground disabled:opacity-50"
          >
            {t("portal.request.submit")}
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        <section aria-label={t("leave.type")} className="flex flex-wrap gap-2">
          {reference.leaveTypes.map((x) => (
            <LeaveTypeChip key={x.id} touch name={x.name} color={x.color} selected={x.id === typeId} onClick={() => setTypeId(x.id)} />
          ))}
        </section>

        <section aria-label={t("leave.dates")} className="space-y-3">
          <DateRangePicker
            touch
            start={range.start}
            end={range.end}
            today={today}
            locale={locale}
            onChange={pick}
            isNonWorking={(iso) => !isWorkWeekday(workDays, isoWeekday(iso)) || holidays.some((h) => h.date === iso && !h.isHalfDay)}
            holidayName={(iso) => holidays.find((h) => h.date === iso)?.name}
          />
          {range.start && range.end ? (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {single ? (
                <HalfDayToggle touch position="single" label={t("halfDay.day")} value={halves.startHalf} onChange={(h) => setHalves({ startHalf: h, endHalf: h })} />
              ) : (
                <>
                  <HalfDayToggle touch position="first" label={t("halfDay.first")} value={halves.startHalf} onChange={(h) => setHalves((x) => ({ ...x, startHalf: h }))} />
                  <HalfDayToggle touch position="last" label={t("halfDay.last")} value={halves.endHalf} onChange={(h) => setHalves((x) => ({ ...x, endHalf: h }))} />
                </>
              )}
            </div>
          ) : null}
          <DaysCountedLine count={count} />
          {zeroDays ? (
            <p role="alert" className="text-status-rejected">
              {t("conflicts.zeroDays")}
            </p>
          ) : null}
          {fresh && preview.data!.balance && type ? (
            <BalancePreview typeName={type.name} available={preview.data!.balance.available} after={preview.data!.balance.after} />
          ) : null}
          <ConflictStrip blocking={conflicts.blocking} warnings={shownWarnings} />
          {certificateExpected ? (
            <p className="rounded-md border border-status-pending/40 bg-status-pending/5 px-3 py-2" data-testid="certificate-expected">
              {t("portal.request.certificateExpected")}
            </p>
          ) : null}
          {fresh && preview.data ? <TeamStrip team={preview.data.team} counts={teamCounts} /> : null}
          {needsAck ? (
            <label className="flex min-h-11 items-start gap-3 rounded-md border px-3 py-2">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" />
              <span>{t("portal.request.acknowledge")}</span>
            </label>
          ) : null}
        </section>

        <section className="space-y-2">
          {noteOpen ? (
            <label className="block space-y-1">
              <span className="text-meta text-muted-foreground">{t("leave.note")}</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} className="w-full rounded-md border bg-background px-3 py-2" />
            </label>
          ) : (
            <button type="button" onClick={() => setNoteOpen(true)} className="h-11 w-full rounded-md border text-start px-3 text-muted-foreground hover:bg-muted">
              {t("portal.request.addNote")}
            </button>
          )}
          {attachVisible ? (
            <AttachmentDrop touch camera file={file} onFile={setFile} onClear={() => setFile(null)} required={type?.requiresAttachment} present={file !== null} />
          ) : (
            <button type="button" onClick={() => setAttachOpen(true)} className="h-11 w-full rounded-md border px-3 text-start text-muted-foreground hover:bg-muted">
              {t("portal.request.addDocument")}
            </button>
          )}
        </section>
      </div>
    </Sheet>
  );
}
