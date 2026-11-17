// Persists the document of a queued (offline) request so it survives a page reload (spec 2.5:
// "queues the submit if the connection drops"). IndexedDB stores File / Blob values natively;
// localStorage cannot. Every call is best-effort: in a private window, with blocked site data or
// without IndexedDB, it quietly does nothing and the outbox falls back to "attach it again".
//
// Only the outbox (outbox.ts) calls this, and it deletes entries together with their queue item:
// on send, on discard, on sign-out and when another person signs in on the same device.

export type StoredFile = { name: string; type: string; lastModified: number; blob: Blob };

export interface FileStore {
  put(id: string, file: File): Promise<void>;
  get(id: string): Promise<File | null>;
  delete(id: string): Promise<void>;
  /** Ids of every stored file (to purge orphans). */
  keys(): Promise<string[]>;
}

const DB = "leave-portal";
const STORE = "outbox-files";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB.open failed"));
  });
}

async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB transaction failed"));
      tx.onabort = () => reject(tx.error ?? new Error("indexedDB transaction aborted"));
    });
  } finally {
    db.close();
  }
}

/** Swallows every failure: persistence is a convenience, never a reason to lose the request. */
async function safe<T>(fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    if (typeof indexedDB === "undefined") return fallback;
    return await fn();
  } catch {
    return fallback;
  }
}

export const indexedDbFileStore: FileStore = {
  put: (id, file) =>
    safe(undefined, async () => {
      const value: StoredFile = { name: file.name, type: file.type, lastModified: file.lastModified, blob: file };
      await run<IDBValidKey>("readwrite", (s) => s.put(value, id));
    }),
  get: (id) =>
    safe(null, async () => {
      const v = await run<StoredFile | undefined>("readonly", (s) => s.get(id));
      return v ? new File([v.blob], v.name, { type: v.type, lastModified: v.lastModified }) : null;
    }),
  delete: (id) =>
    safe(undefined, async () => {
      await run<undefined>("readwrite", (s) => s.delete(id));
    }),
  keys: () => safe([], async () => (await run<IDBValidKey[]>("readonly", (s) => s.getAllKeys())).map(String)),
};
