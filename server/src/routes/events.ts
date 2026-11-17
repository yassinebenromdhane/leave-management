// GET /api/events: Server-Sent Events for live sync (stack §2, spec 4.3).
// Operator → channel "operator"; employee → only `employee:<own id>`. Events are signals with ids
// only; clients invalidate their queries and refetch through the access-checked API.
// The session is re-checked on every heartbeat: sign-out, expiry, archiving or portal access
// removal closes the stream within one heartbeat.
import { AUTH_ERRORS } from "@leave/shared";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { employeeMayUsePortal, loadAuthUser, type AuthUser } from "../auth/middleware";
import { employeeChannel, subscribe, type Channel, type LeaveEvent } from "../realtime/bus";

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

    try {
      await send("ping", ""); // first chunk right away: tells the client the stream is live
      while (!stream.aborted) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([aborted, new Promise((r) => (timer = setTimeout(r, HEARTBEAT_MS)))]);
        clearTimeout(timer);
        if (stream.aborted) break;
        const still = await channelsFor(c);
        if (!still || still.who.userId !== access.who.userId) break;
        await send("ping", "");
      }
    } finally {
      off();
    }
  });
});
