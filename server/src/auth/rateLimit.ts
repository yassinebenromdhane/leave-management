// Per-IP rate limiting for the unauthenticated auth routes (sign-in, forgot and reset password).
// In-memory fixed window: the app is a single Node process by design (stack §2).
// Behind Caddy (TRUST_PROXY=1) the client IP is the first X-Forwarded-For entry, which Caddy sets.
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { env } from "../env";

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

export function clientIp(c: Context): string {
  if (env.TRUST_PROXY) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown"; // e.g. app.request() in tests
  }
}

export function rateLimit(opts: { name: string; max: number; windowMs: number }) {
  return createMiddleware(async (c, next) => {
    const now = Date.now();
    const key = `${opts.name}:${clientIp(c)}`;
    let w = windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + opts.windowMs };
      windows.set(key, w);
    }
    w.count += 1;
    if (w.count > opts.max) {
      c.header("retry-after", String(Math.ceil((w.resetAt - now) / 1000)));
      return c.json({ code: "errors.tooManyRequests" }, 429);
    }
    await next();
  });
}

/** Drops expired windows; called opportunistically so the map cannot grow without bound. */
setInterval(() => {
  const now = Date.now();
  for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
}, 60_000).unref();

/** Test helper. */
export function resetRateLimits(): void {
  windows.clear();
}
