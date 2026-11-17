// audit_log writer (CLAUDE.md invariant 6). Call it inside the same transaction as the change.
// Never pass password hashes, tokens or reset links in before/after.
import type { Db, Tx } from "../db/client";
import { auditLog } from "../db/schema";

export type AuditEntry = {
  entity: string;
  entityId: string;
  action: string;
  actor: string | null; // auth user id, or "system"
  before?: unknown;
  after?: unknown;
};

export async function writeAudit(tx: Tx | Db, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    entity: entry.entity,
    entityId: entry.entityId,
    action: entry.action,
    actor: entry.actor,
    beforeJson: entry.before ?? null,
    afterJson: entry.after ?? null,
  });
}
