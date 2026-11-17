// Attachments (spec 1.2): one live attachment per leave in the MVP, PDF / JPG / PNG up to 10 MB.
// The declared MIME type must match the file's magic bytes. Replacing or removing an attachment
// is a soft delete (attachment.deleted_at); the stored bytes are kept with the history.
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MIME_TYPES, type ConflictResult } from "@leave/shared";
import { and, eq, isNull } from "drizzle-orm";
import { employeeMayUsePortal, type AuthUser } from "../auth/middleware";
import { db, type Tx } from "../db/client";
import { attachment, leaveRequest, leaveType } from "../db/schema";
import { fileStorage } from "../services/fileStorage";
import { writeAudit } from "./audit";
import { DomainError, notFound } from "./errors";

type AttachmentMime = (typeof ATTACHMENT_MIME_TYPES)[number];

const startsWith = (bytes: Uint8Array, sig: readonly number[]) => sig.every((b, i) => bytes[i] === b);

/** MIME type from the file's first bytes, or null when it is not an accepted format. */
export function sniffMime(bytes: Uint8Array): AttachmentMime | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "application/pdf"; // %PDF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  return null;
}

/** Display name only (never a path): last segment, no control characters, bounded length. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 200);
  return cleaned || "attachment";
}

/** Keeps the stored conflict result in step with the attachment fact (operator context: a warning). */
async function syncAttachmentWarning(tx: Tx, leaveRequestId: string, present: boolean) {
  const [row] = await tx
    .select({ conflictResult: leaveRequest.conflictResult, requires: leaveType.requiresAttachment })
    .from(leaveRequest)
    .innerJoin(leaveType, eq(leaveType.id, leaveRequest.leaveTypeId))
    .where(eq(leaveRequest.id, leaveRequestId));
  const current = (row?.conflictResult ?? null) as ConflictResult | null;
  if (!row || !current) return;
  const warnings = current.warnings.filter((w) => w.code !== "conflicts.attachmentMissing");
  if (!present && row.requires) warnings.push({ code: "conflicts.attachmentMissing", severity: "warning" });
  const next: ConflictResult = { blocking: current.blocking, warnings };
  await tx
    .update(leaveRequest)
    .set({ conflictResult: next, hasWarning: warnings.length > 0 })
    .where(eq(leaveRequest.id, leaveRequestId));
}

const view = (a: typeof attachment.$inferSelect) => ({
  id: a.id,
  leaveRequestId: a.leaveRequestId,
  fileName: a.fileName,
  mimeType: a.mimeType,
  sizeBytes: a.sizeBytes,
  uploadedAt: a.uploadedAt.toISOString(),
});

/** A validated upload: size, magic bytes and declared MIME all checked (spec 1.2). */
export type CheckedUpload = { bytes: Uint8Array; mimeType: AttachmentMime; fileName: string };

export async function checkUpload(file: File): Promise<CheckedUpload> {
  if (file.size > ATTACHMENT_MAX_BYTES) throw new DomainError("attachments.errors.tooLarge", 413);
  if (file.size === 0) throw new DomainError("attachments.errors.empty", 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffMime(bytes);
  if (!sniffed || !(ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type) || sniffed !== file.type) {
    throw new DomainError("attachments.errors.type", 415);
  }
  return { bytes, mimeType: sniffed, fileName: cleanFileName(file.name) };
}

/**
 * Stores the bytes, then runs `fn` with the storage key. When `fn` fails (transaction rolled
 * back), the stored file is removed again so no orphan stays on disk.
 */
export async function withStoredFile<T>(bytes: Uint8Array, fn: (storageKey: string) => Promise<T>): Promise<T> {
  const storageKey = await fileStorage.put(bytes);
  try {
    return await fn(storageKey);
  } catch (err) {
    await fileStorage.delete(storageKey).catch(() => {});
    throw err;
  }
}

/** Inserts the attachment row (+ audit) inside the caller's transaction, replacing any live one. */
export async function insertAttachment(tx: Tx, leaveRequestId: string, upload: CheckedUpload, storageKey: string, actor: string) {
  const replaced = await tx
    .update(attachment)
    .set({ deletedAt: new Date() })
    .where(and(eq(attachment.leaveRequestId, leaveRequestId), isNull(attachment.deletedAt)))
    .returning();
  const [created] = await tx
    .insert(attachment)
    .values({ leaveRequestId, fileName: upload.fileName, mimeType: upload.mimeType, sizeBytes: upload.bytes.byteLength, storageKey })
    .returning();
  await writeAudit(tx, {
    entity: "attachment",
    entityId: created!.id,
    action: "attachment.upload",
    actor,
    before: replaced.length ? replaced.map(view) : null,
    after: view(created!), // metadata only, never the file contents
  });
  return view(created!);
}

export async function uploadAttachment(leaveRequestId: string, file: File, actor: string) {
  const [leave] = await db
    .select({ id: leaveRequest.id })
    .from(leaveRequest)
    .where(and(eq(leaveRequest.id, leaveRequestId), isNull(leaveRequest.deletedAt)));
  if (!leave) throw notFound();

  const upload = await checkUpload(file);
  return withStoredFile(upload.bytes, (storageKey) =>
    db.transaction(async (tx) => {
      const created = await insertAttachment(tx, leaveRequestId, upload, storageKey, actor);
      await syncAttachmentWarning(tx, leaveRequestId, true);
      return created;
    }),
  );
}

/** Soft delete of a live attachment row already locked by the caller (+ warning sync + audit). */
export async function softDeleteAttachment(tx: Tx, before: typeof attachment.$inferSelect, actor: string) {
  const [after] = await tx.update(attachment).set({ deletedAt: new Date() }).where(eq(attachment.id, before.id)).returning();
  await syncAttachmentWarning(tx, before.leaveRequestId, false);
  await writeAudit(tx, {
    entity: "attachment",
    entityId: before.id,
    action: "attachment.delete",
    actor,
    before: view(before),
    after: { ...view(after!), deletedAt: after!.deletedAt?.toISOString() ?? null },
  });
}

export async function deleteAttachment(id: string, actor: string) {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(attachment)
      .where(and(eq(attachment.id, id), isNull(attachment.deletedAt)))
      .for("update");
    if (!before) throw notFound();
    await softDeleteAttachment(tx, before, actor);
    return { ok: true as const };
  });
}

/**
 * Download access: the operator, or the employee who owns the leave (with live portal access).
 * Everything else, deleted rows included, is a 404 so existence never leaks.
 */
export async function openAttachment(id: string, who: AuthUser) {
  const [row] = await db
    .select({ a: attachment, employeeId: leaveRequest.employeeId })
    .from(attachment)
    .innerJoin(leaveRequest, eq(leaveRequest.id, attachment.leaveRequestId))
    .where(and(eq(attachment.id, id), isNull(attachment.deletedAt), isNull(leaveRequest.deletedAt)));
  if (!row) throw notFound();
  if (who.role === "employee") {
    if (!who.employeeId || who.employeeId !== row.employeeId) throw notFound();
    if (!(await employeeMayUsePortal(who.employeeId))) throw notFound();
  }
  const stream = await fileStorage.get(row.a.storageKey);
  if (!stream) throw notFound();
  return { stream, fileName: row.a.fileName, mimeType: row.a.mimeType, sizeBytes: row.a.sizeBytes };
}
