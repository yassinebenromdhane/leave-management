// Offline queue for portal submits (spec 2.5). The payload is persisted in localStorage and the
// attached document in IndexedDB (fileStore.ts), so a queued request survives a reload with its
// file. If the browser cannot keep the file (private window, blocked storage), the request is
// still kept and the UI asks for the document again. Nothing here ever pretends the server
// accepted it: a queued item shows as "Sending…" until a real server answer removes it.
//
// Shared devices (spec 4.3 "own rows only"): every item is stamped with the user who queued it.
// Only the current owner's items are listed or sent, and setting a different owner (another person
// signs in) or none (sign-out) deletes everything else — payloads, notes and stored files —
// so one employee's request can never be sent as, or read by, another.
import type { PortalLeaveSubmitInput } from "@leave/shared";
import { readJson, writeStorage } from "@/common/lib/storage";
import { indexedDbFileStore, type FileStore } from "./fileStore";

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
const files = new Map<string, File>(); // in-memory copy; IndexedDB holds the durable one
const listeners = new Set<() => void>();
let store: FileStore = indexedDbFileStore;
// Items written by an older version have no owner: they can't be attributed, so they are dropped.
const load = () => readJson<OutboxItem[]>(KEY, []).filter((i) => typeof i.ownerUserId === "string");
let items: OutboxItem[] = load();
let owner: string | null = null;
let visible: OutboxItem[] = [];
let hydration: Promise<void> | null = null;
let hydrated = false;

const recompute = () => {
  visible = owner ? items.filter((i) => i.ownerUserId === owner) : [];
};

const emit = () => {
  recompute();
  writeStorage(KEY, JSON.stringify(items));
  listeners.forEach((l) => l());
};

const dropFile = (id: string) => {
  files.delete(id);
  void store.delete(id);
};

/** Loads the stored documents of the queued items, and deletes stored files nobody owns. */
async function hydrate(): Promise<void> {
  const known = new Set(items.map((i) => i.id));
  for (const key of await store.keys()) if (!known.has(key)) await store.delete(key);
  for (const i of items) {
    if (!i.hadFile || files.has(i.id)) continue;
    const file = await store.get(i.id);
    if (file && items.some((x) => x.id === i.id)) files.set(i.id, file);
  }
  hydrated = true;
  emit();
}

export const outbox = {
  /** Current owner's items. Stable snapshot for useSyncExternalStore. */
  all: (): OutboxItem[] => visible,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  /** Resolves once the stored documents are loaded. Await it before sending anything. */
  ready: (): Promise<void> => (hydration ??= hydrate()),
  /**
   * Declares who is signed in on this device (null = signed out). Any item queued by someone
   * else is deleted, with its file.
   */
  setOwner(userId: string | null): void {
    if (userId === owner) return;
    owner = userId;
    for (const i of items) if (i.ownerUserId !== userId) dropFile(i.id);
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
    if (file) {
      files.set(item.id, file);
      void store.put(item.id, file);
    }
    items = [...items, item];
    emit();
    return item;
  },
  remove(id: string): void {
    dropFile(id);
    items = items.filter((i) => i.id !== id);
    emit();
  },
  fileFor: (id: string): File | null => files.get(id) ?? null,
  /** The document was queued but could not be kept (storage unavailable): attach it again. */
  fileLost: (item: OutboxItem): boolean => hydrated && item.hadFile && !files.has(item.id),

  // ---------- tests only ----------
  reset(): void {
    for (const id of files.keys()) void store.delete(id);
    files.clear();
    items = [];
    owner = null;
    hydration = null;
    hydrated = false;
    emit();
  },
  /** Swap the durable file store (a fake in tests). */
  useFileStore(s: FileStore): void {
    store = s;
  },
  /** Simulates a page reload: memory is lost, localStorage and the file store remain. */
  simulateReload(): void {
    files.clear();
    items = load();
    owner = null;
    hydration = null;
    hydrated = false;
    recompute();
  },
};
