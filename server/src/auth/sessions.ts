import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { session } from "../db/schema";
import { closeStreamsOf } from "../realtime/bus";

/**
 * Signs a user out of every device (spec 2.5 revocation, archive, password change) and closes
 * their open live-update streams at once, instead of at the next heartbeat.
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db.delete(session).where(eq(session.userId, userId));
  closeStreamsOf(userId);
}
