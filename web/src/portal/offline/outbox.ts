// Offline queue for portal submits (spec 2.5). The payload is persisted in localStorage so a
// request survives a reload; a File blob is not (impractical), so after a reload the employee must
// re-attach the document, and the UI says so. Nothing here ever pretends the server accepted it:
// a queued item shows as "Sending…" until a real server answer removes it.
//
// Shared devices (spec 4.3 "own rows only"): every item is stamped with the user who queued it.
// Only the current owner's items are listed or sent, and setting a different owner (another person
// signs in) or none (sign-out) deletes everything else — payloads, notes and in-memory files —
// so one employee's request can never be sent as, or read by, another.
import type { PortalLeaveSubmitInput } from "@leave/shared";
import { readJson, writeStorage } from "@/common/lib/storage";

export type OutboxItem = {
  id: string;
  /** Auth user id of the employee who queued it. */
  ownerUserId: string;
  payload: PortalLeaveSubmitInput;
  typeName: string;
  queuedAt: string;
  /** A document was attached when the request was queued. */
  hadFile: boolean;
};

const KEY = "portal.outbox";
const files = new Map<string, File>(); // survives only while the tab lives
const listeners = new Set<() => void>();
// Items written by an older version have no owner: they can't be attributed, so they are dropped.
let items: OutboxItem[] = readJson<OutboxItem[]>(KEY, []).filter((i) => typeof i.ownerUserId === "string");
let owner: string | null = null;
let visible: OutboxItem[] = [];

const recompute = () => {
  visible = owner ? items.filter((i) => i.ownerUserId === owner) : [];
};

const emit = () => {
  recompute();
  writeStorage(KEY, JSON.stringify(items));
  listeners.forEach((l) => l());
};

export const outbox = {
  /** Current owner's items. Stable snapshot for useSyncExternalStore. */
  all: (): OutboxItem[] => visible,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  /**
   * Declares who is signed in on this device (null = signed out). Any item queued by someone
   * else is deleted, with its file.
   */
  setOwner(userId: string | null): void {
    if (userId === owner) return;
    owner = userId;
    const stale = items.filter((i) => i.ownerUserId !== userId);
    for (const i of stale) files.delete(i.id);
    items = items.filter((i) => i.ownerUserId === userId);
    emit();
  },
  owner: (): string | null => owner,
  enqueue(payload: PortalLeaveSubmitInput, typeName: string, file: File | null): OutboxItem {
    if (!owner) throw new Error("outbox: no signed-in owner");
    const item: OutboxItem = {
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ownerUserId: owner,
      payload,
      typeName,
      queuedAt: new Date().toISOString(),
      hadFile: file !== null,
    };
    if (file) files.set(item.id, file);
    items = [...items, item];
    emit();
    return item;
  },
  remove(id: string): void {
    files.delete(id);
    items = items.filter((i) => i.id !== id);
    emit();
  },
  fileFor: (id: string): File | null => files.get(id) ?? null,
  /** The document was queued but is gone (page reloaded): it must be attached again. */
  fileLost: (item: OutboxItem): boolean => item.hadFile && !files.has(item.id),
  /** Tests only. */
  reset(): void {
    files.clear();
    items = [];
    owner = null;
    emit();
  },
};
