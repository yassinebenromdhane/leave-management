// Attachment storage (stack §1): local disk volume behind an interface, so another backend can
// replace it. Files are never served statically; downloads go through /api/files/:id with an
// access check. Storage keys are random hex generated here; no user-supplied path segment ever
// reaches the file system.
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { env } from "../env";

export interface FileStorage {
  /** Stores the bytes and returns a new opaque storage key. */
  put(data: Uint8Array): Promise<string>;
  /** Web stream of the stored bytes, or null when the key is unknown. */
  get(key: string): Promise<ReadableStream<Uint8Array> | null>;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[a-f0-9]{32}$/;

export class LocalDiskStorage implements FileStorage {
  private readonly root: string;
  private ready: Promise<unknown> | null = null;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private ensureRoot() {
    this.ready ??= mkdir(this.root, { recursive: true });
    return this.ready;
  }

  /** Absolute path for a key; refuses anything that is not one of our keys. */
  private pathFor(key: string): string {
    if (!KEY_RE.test(key)) throw new Error("Invalid storage key");
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error("Invalid storage key");
    return p;
  }

  async put(data: Uint8Array): Promise<string> {
    await this.ensureRoot();
    const key = randomBytes(16).toString("hex");
    await writeFile(this.pathFor(key), data, { flag: "wx", mode: 0o600 });
    return key;
  }

  async get(key: string): Promise<ReadableStream<Uint8Array> | null> {
    const p = this.pathFor(key);
    try {
      await stat(p);
    } catch {
      return null;
    }
    return Readable.toWeb(createReadStream(p)) as ReadableStream<Uint8Array>;
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

export const fileStorage: FileStorage = new LocalDiskStorage(env.UPLOAD_DIR);
