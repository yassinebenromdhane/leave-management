// GET /api/events: Server-Sent Events for live sync (stack §2, spec 4.3).
// Operator → channel "operator"; employee → only `employee:<own id>`. Events are signals with ids
// only; clients invalidate their queries and refetch through the access-checked API.
// Revoking a user's sessions (archive, portal access removed, password change, sign-out
// everywhere) closes their streams at once (revokeAllSessions → closeStreamsOf). The session is
// also re-checked on every heartbeat as a backstop (plain sign-out, expiry). At most
// MAX_STREAMS_PER_USER streams per user: a new tab closes the oldest one.
import { AUTH_ERRORS } from "@leave/shared";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { employeeMayUsePortal, loadAuthUser, type AuthUser } from "../auth/middleware";
import { employeeChannel, registerStream, subscribe, type Channel, type LeaveEvent } from "../realtime/bus";

export const HEARTBEAT_MS = 25_000;

/** Channels the signed-in user may listen to, or null when the stream must not (re)open. */
async function channelsFor(c: Context): Promise<{ who: AuthUser; channels: Channel[] } | null> {
  const who = await loadAuthUser(c);
  if (!who || who.mustChangePassword) return null;
  if (who.role === "operator") return { who, channels: ["operator"] };
  if (who.employeeId && (await employeeMayUsePortal(who.employeeId))) {
    return { who, channels: [employeeChannel(who.employeeId)] };
  }
  return null;
}

export const eventRoutes = new Hono().get("/", async (c) => {
  const access = await channelsFor(c);
  if (!access) return c.json({ code: AUTH_ERRORS.unauthenticated }, 401);
  c.header("X-Accel-Buffering", "no"); // no proxy buffering of the stream

  return streamSSE(c, async (stream) => {
    // Writes are chained so an event and a heartbeat never interleave.
    let queue: Promise<unknown> = Promise.resolve();
    const send = (event: string, data: string) => {
      queue = queue.then(() => stream.writeSSE({ event, data }));
      return queue;
    };
    const off = subscribe(access.channels, (e: LeaveEvent) => {
      void send(e.type, JSON.stringify(e));
    });

    let wake: () => void = () => {};
    const aborted = new Promise<void>((resolve) => {
      wake = resolve;
    });
    stream.onAbort(() => {
      off();
      wake();
    });
    // Closed from outside when the user's sessions are revoked, or past the per-user cap.
    let closed = false;
    const unregister = registerStream(access.who.userId, () => {
      closed = true;
      wake();
    });

    try {
      await send("ping", ""); // first chunk right away: tells the client the stream is live
      while (!stream.aborted) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([aborted, new Promise((r) => (timer = setTimeout(r, HEARTBEAT_MS)))]);
        clearTimeout(timer);
        if (stream.aborted || closed) break;
        const still = await channelsFor(c);
        if (!still || still.who.userId !== access.who.userId) break;
        await send("ping", "");
      }
    } finally {
      off();
      unregister();
    }
  });
});
