// Spec 2.5: 5 failed attempts lock the account for 15 minutes.
//
// Race-free: each sign-in first RESERVES an attempt with one atomic UPDATE, before the password
// is checked. Parallel guesses therefore each get a distinct attempt number, and any request
// beyond the 5th is refused without its password ever being verified.
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { user } from "../db/schema";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

/**
 * Reserves one attempt. Returns the attempt number (1-based) or null when the account is locked.
 * Attempt numbers above MAX_FAILED_ATTEMPTS lock the account immediately.
 */
export async function reserveAttempt(userId: string): Promise<number | null> {
  const [row] = await db
    .update(user)
    .set({ failedAttempts: sql`${user.failedAttempts} + 1`, lockedUntil: null })
    .where(sql`${user.id} = ${userId} and (${user.lockedUntil} is null or ${user.lockedUntil} <= now())`)
    .returning({ attempt: user.failedAttempts });
  if (!row) return null;
  if (row.attempt > MAX_FAILED_ATTEMPTS) {
    await lock(userId);
    return null;
  }
  return row.attempt;
}

/** Called after a wrong password for a reserved attempt. The 5th failure locks the account. */
export async function recordFailedAttempt(userId: string, attempt: number): Promise<void> {
  if (attempt >= MAX_FAILED_ATTEMPTS) await lock(userId);
}

async function lock(userId: string): Promise<void> {
  await db
    .update(user)
    .set({ failedAttempts: 0, lockedUntil: sql`now() + make_interval(mins => ${LOCK_MINUTES})` })
    .where(eq(user.id, userId));
}

export async function recordSuccessfulLogin(userId: string): Promise<void> {
  await db
    .update(user)
    .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(user.id, userId));
}
