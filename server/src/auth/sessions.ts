import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { session } from "../db/schema";

/** Signs a user out of every device (spec 2.5 revocation, archive, password change). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db.delete(session).where(eq(session.userId, userId));
}
