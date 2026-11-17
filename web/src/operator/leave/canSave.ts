export type SaveState = {
  employeeId: string;
  leaveTypeId: string;
  start: string;
  end: string;
  halfValid: boolean;
  /** Locally counted working days (shared workingDays); 0 or null blocks. */
  days: number | null;
  /** Blocking issues from the server preview (spec 1.3). */
  blockingCount: number;
  saving: boolean;
};

/** Save is disabled while any blocking issue exists; warnings never disable it. */
export function canSaveLeave(s: SaveState): boolean {
  if (s.saving) return false;
  if (!s.employeeId || !s.leaveTypeId || !s.start || !s.end || s.end < s.start) return false;
  if (!s.halfValid) return false;
  if (s.days === null || s.days <= 0) return false;
  return s.blockingCount === 0;
}
