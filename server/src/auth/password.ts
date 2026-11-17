// Argon2id hashing (spec 2.5), plugged into Better Auth's emailAndPassword.password.
import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

// @node-rs/argon2 exports Algorithm as a `const enum`, which isolatedModules can't import.
// 2 = Algorithm.Argon2id. Parameters follow the OWASP recommendation (19 MiB, t=2, p=1).
const ARGON2ID = 2;
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword({ hash: stored, password }: { hash: string; password: string }): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false; // malformed hash never authenticates
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the same time as a real password check. Used when the account is unknown or locked,
 * so response timing does not reveal whether an email exists (spec 2.5).
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword({ hash: await dummyHash, password });
}

/** Temporary password the operator hands over (spec 2.5 "Without email"). 12 readable characters. */
export function generateTemporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
