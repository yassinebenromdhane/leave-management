// Leave drawer (spec 1.2): the 10-second flow. C -> type 3 letters -> Enter -> pick a range ->
// Ctrl+Enter, with the page visible behind it. Live figures call @leave/shared directly; the
// server preview supplies what only it knows (other leaves, ledger balance, colleagues off).
import {
  isValidHalfCombination,
  isWorkWeekday,
  isoWeekday,
  leaveCreateSchema,
  workingDays,
  type HalfDay,
  type LeaveCreateInput,
  type SaveStatus,
} from "@leave/shared";
import { Paperclip, Trash2, Check, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEmployees, type EmployeeRow } from "@/common/api/employees";
import { invalidateLeaveData } from "@/common/api/invalidate";
import { leaveApi, useLeave, useLeavePreview, type LeaveDetail } from "@/common/api/leaves";
import { useReference, type LeaveTypeRef, type Reference } from "@/common/api/reference";
import { AttachmentDrop } from "@/common/components/AttachmentDrop";
import { BalancePreview } from "@/common/components/BalancePreview";
import { ConflictStrip } from "@/common/components/ConflictStrip";
import { DateRangePicker } from "@/common/components/DateRangePicker";
import { DaysCountedLine } from "@/common/components/DaysCountedLine";
import { HalfDayToggle, normalizeHalves } from "@/common/components/HalfDayToggle";
import { LeaveTypeChip } from "@/common/components/LeaveTypeChip";
import { StatusPill } from "@/common/components/StatusPill";
import { useDebounced } from "@/common/hooks/useDebounced";
import { useShortcuts } from "@/common/hooks/useShortcuts";
import { todayIso } from "@/common/lib/date";
import { errorMessage } from "@/common/lib/errorMessage";
import { readJson, readStorage, writeStorage } from "@/common/lib/storage";
import { ConfirmDialog } from "@/ui/Dialog";
import { Sheet } from "@/ui/Sheet";
import { Skeleton } from "@/ui/Skeleton";
import { useDrawerNav } from "../useDrawerNav";
import { useLeaveActions } from "../useLeaveActions";
import { canSaveLeave } from "./canSave";
import { EmployeePicker } from "./EmployeePicker";

const LAST_TYPE_KEY = "leave.lastType";
const RECENT_KEY = "leave.recentEmployees";

export default function LeaveDrawer() {
  const { id } = useParams();
  const { t } = useTranslation();
  const nav = useDrawerNav();
  const reference = useReference();
  const employees = useEmployees("all");
  const leave = useLeave(id);

  const title = id ? t("leave.edit") : t("leave.new");
  const loading = reference.isPending || employees.isPending || (id !== undefined && leave.isPending);
  const failed = reference.error ?? employees.error ?? (id ? leave.error : null);

  if (loading || failed || !reference.data || !employees.data || (id && !leave.data)) {
    return (
      <Sheet title={title} onClose={nav.close}>
        <div className="space-y-3 p-4" role="status" aria-label={t("common.loading")}>
          {failed ? (
            <p role="alert" className="text-status-rejected">
              {errorMessage(t, failed)}
            </p>
          ) : (
            <>
              <Skeleton className="h-9" />
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-48" />
            </>
          )}
        </div>
      </Sheet>
    );
  }
  return <LeaveForm key={id ?? "new"} reference={reference.data} employees={employees.data} leave={leave.data} />;
}

function defaultTypeId(reference: Reference): string {
  const last = readStorage(LAST_TYPE_KEY);
  if (last && reference.leaveTypes.some((x) => x.id === last)) return last;
  return (reference.leaveTypes.find((x) => x.code === "paid") ?? reference.leaveTypes[0])?.id ?? "";
}

function LeaveForm({ reference, employees, leave }: { reference: Reference; employees: EmployeeRow[]; leave: LeaveDetail | undefined }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const nav = useDrawerNav();
  const qc = useQueryClient();
  const actions = useLeaveActions();
  const [params] = useSearchParams();
  const today = todayIso();
  const gridRef = useRef<HTMLDivElement | null>(null);

  const initial = useMemo(
    () => ({
      employeeId: leave?.employeeId ?? params.get("employee") ?? "",
      leaveTypeId: leave?.leaveTypeId ?? defaultTypeId(reference),
      start: leave?.startDate ?? params.get("start") ?? "",
      end: leave?.endDate ?? params.get("end") ?? params.get("start") ?? "",
      startHalf: (leave?.startHalf ?? "full") as HalfDay,
      endHalf: (leave?.endHalf ?? "full") as HalfDay,
      note: leave?.note ?? "",
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [form, setForm] = useState(initial);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const patch = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  const employee = employees.find((e) => e.id === form.employeeId) ?? null;
  const type: LeaveTypeRef | undefined = reference.leaveTypes.find((x) => x.id === form.leaveTypeId);
  const activeEmployees = useMemo(() => employees.filter((e) => e.status === "active"), [employees]);
  const recentIds = useMemo(() => readJson<string[]>(RECENT_KEY, []), []);

  const dirty = file !== null || JSON.stringify(form) !== JSON.stringify(initial);
  const requestClose = () => (dirty ? setDiscard(true) : nav.close());

  // ---- live count: the shared rule, same inputs as the server ----
  const span = { startDate: form.start, endDate: form.end, startHalf: form.startHalf, endHalf: form.endHalf };
  const halfValid = form.start !== "" && form.end !== "" && isValidHalfCombination(span);
  const workDays = employee?.workDaysOverride ?? reference.workDays;
  const holidays = reference.holidays;
  const count = useMemo(() => {
    if (!halfValid || !type) return null;
    try {
      return workingDays({ ...span, mode: type.dayCountMode, workDays, holidays });
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [halfValid, type, form.start, form.end, form.startHalf, form.endHalf, workDays, holidays]);

  // ---- server preview, debounced ~250 ms ----
  const hasAttachment = file !== null || (leave?.attachments.length ?? 0) > 0;
  const previewKey = employee && type && halfValid
    ? JSON.stringify({
        employeeId: employee.id,
        leaveTypeId: type.id,
        startDate: form.start,
        endDate: form.end,
        startHalf: form.startHalf,
        endHalf: form.endHalf,
        excludeLeaveId: leave?.id,
        hasAttachment,
      })
    : null;
  const debouncedKey = useDebounced(previewKey, 250);
  const preview = useLeavePreview(debouncedKey ? JSON.parse(debouncedKey) : null);
  const conflicts = preview.data?.conflicts ?? leave?.conflictResult ?? { blocking: [], warnings: [] };
  const blockingCount = conflicts.blocking.length;

  const canSave = canSaveLeave({
    employeeId: form.employeeId,
    leaveTypeId: form.leaveTypeId,
    start: form.start,
    end: form.end,
    halfValid,
    days: count?.days ?? null,
    blockingCount,
    saving,
  });

  const defaultStatus: SaveStatus = type?.defaultSaveStatus ?? reference.settings.defaultSaveStatus;
  const single = form.start !== "" && form.start === form.end;

  const setRange = (start: string, end: string) => {
    const h = normalizeHalves(start, end, form.startHalf, form.endHalf);
    patch({ start, end, ...h });
  };

  const submit = async (status?: SaveStatus) => {
    if (!canSave || !employee || !type) return;
    setError(null);
    const input: LeaveCreateInput = {
      employeeId: employee.id,
      leaveTypeId: type.id,
      startDate: form.start,
      endDate: form.end,
      startHalf: form.startHalf,
      endHalf: form.endHalf,
      note: form.note.trim() || null,
      ...(status ? { status } : {}),
    };
    const parsed = leaveCreateSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => t(i.message)).join(" "));
      return;
    }
    setSaving(true);
    try {
      if (leave) {
        await actions.update(leave, {
          leaveTypeId: type.id,
          startDate: form.start,
          endDate: form.end,
          startHalf: form.startHalf,
          endHalf: form.endHalf,
          note: form.note.trim() || null,
        });
      } else {
        await actions.create(
          input,
          {
            employeeName: employee.fullName,
            departmentName: employee.departmentName,
            typeName: type.name,
            color: type.color,
            workingDays: count?.days ?? 0,
            status: status ?? defaultStatus,
          },
          file,
        );
      }
      writeStorage(LAST_TYPE_KEY, type.id);
      writeStorage(RECENT_KEY, JSON.stringify([employee.id, ...recentIds.filter((x) => x !== employee.id)].slice(0, 5)));
      nav.close();
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setSaving(false);
    }
  };

  const typeKeys: Record<string, () => void> = {};
  reference.leaveTypes.slice(0, 9).forEach((x, i) => {
    typeKeys[String(i + 1)] = () => patch({ leaveTypeId: x.id });
  });
  useShortcuts({
    ...typeKeys,
    "mod+enter": () => void submit(),
    "mod+shift+enter": () => void submit("pending"),
    a: () => leave && leave.status !== "approved" && void actions.setStatus(leave, "approved"),
    r: () => leave && leave.status !== "rejected" && setRejecting(true),
  });

  const uploadNow = async (f: File) => {
    if (!leave) return setFile(f);
    try {
      await leaveApi.upload(leave.id, f);
      await invalidateLeaveData(qc);
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  const days = count?.days ?? null;
  const headerExtra = leave ? (
    <span className="flex items-center gap-2">
      {leave.source === "portal" ? <span className="rounded border px-1.5 text-meta text-muted-foreground">{t("source.portalMarker")}</span> : null}
      <StatusPill status={leave.status} />
    </span>
  ) : null;

  return (
    <Sheet
      title={leave ? `${t("leave.edit")} · ${leave.employeeName}` : t("leave.new")}
      onClose={requestClose}
      headerExtra={headerExtra}
      footer={
        <div className="space-y-2">
          {error ? (
            <p role="alert" className="rounded-md border border-status-rejected/40 bg-status-rejected/5 px-3 py-2 text-status-rejected">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {leave ? (
              <button
                type="button"
                onClick={async () => {
                  if (await actions.remove(leave)) nav.close();
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-status-rejected hover:bg-muted max-md:h-11"
              >
                <Trash2 size={14} aria-hidden="true" />
                {t("common.delete")}
              </button>
            ) : null}
            <span className="flex-1" />
            {!leave && defaultStatus !== "pending" ? (
              <button
                type="button"
                disabled={!canSave}
                onClick={() => void submit("pending")}
                className="h-9 rounded-md border px-3 hover:bg-muted disabled:opacity-50 max-md:h-11"
                title={t("shortcuts.savePending")}
              >
                {t("leave.saveAsPending")}
              </button>
            ) : null}
            <button
              type="button"
              disabled={!canSave}
              onClick={() => void submit()}
              className="h-9 rounded-md bg-accent px-4 font-medium text-accent-foreground disabled:opacity-50 max-md:h-11"
              title={t("shortcuts.save")}
            >
              {leave ? t("leave.saveChanges") : t("leave.saveAs", { status: t(`status.${defaultStatus}`).toLocaleLowerCase(locale) })}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        {/* Who */}
        <section aria-label={t("leave.employee")}>
          {leave ? (
            <button type="button" onClick={() => nav.open(`/employees/${leave.employeeId}`)} className="font-medium underline-offset-2 hover:underline">
              {leave.employeeName}
              <span className="font-normal text-muted-foreground"> · {leave.departmentName}</span>
            </button>
          ) : (
            <EmployeePicker
              employees={activeEmployees}
              recentIds={recentIds}
              value={employee}
              onSelect={(id) => {
                patch({ employeeId: id });
                requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>('[data-date][tabindex="0"]')?.focus());
              }}
              onClear={() => patch({ employeeId: "" })}
            />
          )}
        </section>

        {/* Type */}
        <section aria-label={t("leave.type")} className="flex flex-wrap gap-1.5">
          {reference.leaveTypes.map((x, i) => (
            <LeaveTypeChip key={x.id} name={x.name} color={x.color} selected={x.id === form.leaveTypeId} shortcut={i < 9 ? i + 1 : undefined} onClick={() => patch({ leaveTypeId: x.id })} />
          ))}
        </section>

        {/* When */}
        <section aria-label={t("leave.dates")} className="space-y-3">
          <DateRangePicker
            start={form.start}
            end={form.end}
            today={today}
            locale={locale}
            gridRef={gridRef}
            onChange={setRange}
            isNonWorking={(iso) => !isWorkWeekday(workDays, isoWeekday(iso)) || holidays.some((h) => h.date === iso && !h.isHalfDay)}
            holidayName={(iso) => holidays.find((h) => h.date === iso)?.name}
          />
          {form.start && form.end ? (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {single ? (
                <HalfDayToggle
                  position="single"
                  label={t("halfDay.day")}
                  value={form.startHalf}
                  onChange={(h) => patch({ startHalf: h, endHalf: h })}
                />
              ) : (
                <>
                  <HalfDayToggle position="first" label={t("halfDay.first")} value={form.startHalf} onChange={(h) => patch({ startHalf: h })} />
                  <HalfDayToggle position="last" label={t("halfDay.last")} value={form.endHalf} onChange={(h) => patch({ endHalf: h })} />
                </>
              )}
            </div>
          ) : null}
          <DaysCountedLine count={count} />
          {preview.data?.balance && type ? (
            <BalancePreview typeName={type.name} available={preview.data.balance.available} after={preview.data.balance.after} />
          ) : null}
          <ConflictStrip blocking={conflicts.blocking} warnings={conflicts.warnings} onOpenLeave={(lid) => nav.open(`/leave/${lid}`)} />
        </section>

        {/* Attachment */}
        <section aria-label={t("attachments.title")} className="space-y-2">
          {leave?.attachments.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5">
              <Paperclip size={14} aria-hidden="true" className="text-muted-foreground" />
              <a href={`/api/files/${a.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">
                {a.fileName}
              </a>
              <button
                type="button"
                aria-label={t("attachments.remove")}
                onClick={async () => {
                  try {
                    await leaveApi.removeAttachment(a.id);
                    await invalidateLeaveData(qc);
                  } catch (err) {
                    setError(errorMessage(t, err));
                  }
                }}
                className="grid h-8 w-8 place-items-center rounded hover:bg-muted max-md:h-11 max-md:w-11"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
          <AttachmentDrop file={leave ? null : file} onFile={(f) => void uploadNow(f)} onClear={() => setFile(null)} required={type?.requiresAttachment} present={hasAttachment} />
        </section>

        {/* Note */}
        <label className="block space-y-1">
          <span className="text-meta text-muted-foreground">{t("leave.note")}</span>
          <textarea
            value={form.note}
            onChange={(e) => patch({ note: e.target.value })}
            rows={2}
            maxLength={1000}
            className="w-full rounded-md border bg-background px-3 py-2"
          />
        </label>

        {/* Decision (existing leaves) */}
        {leave ? (
          <section aria-label={t("leave.decision")} className="space-y-2 border-t pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={leave.status === "approved"}
                onClick={() => void actions.setStatus(leave, "approved")}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 hover:bg-muted disabled:opacity-50 max-md:h-11"
              >
                <Check size={14} className="text-status-approved" aria-hidden="true" />
                {t("leave.approve")} <kbd className="text-meta text-muted-foreground">A</kbd>
              </button>
              <button
                type="button"
                disabled={leave.status === "rejected"}
                onClick={() => setRejecting((r) => !r)}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 hover:bg-muted disabled:opacity-50 max-md:h-11"
              >
                <X size={14} className="text-status-rejected" aria-hidden="true" />
                {t("leave.reject")} <kbd className="text-meta text-muted-foreground">R</kbd>
              </button>
              {days !== null && leave.workingDays !== days ? <span className="text-meta text-muted-foreground">{t("leave.recountOnSave")}</span> : null}
            </div>
            {rejecting ? (
              <form
                className="flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setRejecting(false);
                  await actions.setStatus(leave, "rejected", reason.trim() || undefined);
                }}
              >
                <input
                  autoFocus
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  aria-label={t("leave.rejectReason")}
                  placeholder={t("leave.rejectReason")}
                  className="h-9 min-w-0 flex-1 rounded-md border px-3 max-md:h-11"
                />
                <button type="submit" className="h-9 rounded-md bg-status-rejected px-3 text-accent-foreground max-md:h-11">
                  {t("leave.confirmReject")}
                </button>
              </form>
            ) : null}
            {leave.rejectReason ? <p className="text-muted-foreground">{t("leave.rejectedBecause", { reason: leave.rejectReason })}</p> : null}
          </section>
        ) : null}
      </div>

      {discard ? (
        <ConfirmDialog
          title={t("leave.discardTitle")}
          message={t("leave.discardMessage")}
          confirmLabel={t("leave.discard")}
          destructive
          onCancel={() => setDiscard(false)}
          onConfirm={() => {
            setDiscard(false);
            nav.close();
          }}
        />
      ) : null}
    </Sheet>
  );
}
