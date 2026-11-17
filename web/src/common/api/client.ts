import type { AppType } from "@leave/server";
import { hc } from "hono/client";

/** Typed API client. Route changes in server/src/app.ts become compile errors here. */
export const api = hc<AppType>("/", {
  init: { credentials: "same-origin" },
});

/** Same typed routes on an absolute base: `$url()` needs one (a relative "/" is not a valid URL). */
export const apiForUrls = (): typeof api => hc<AppType>(globalThis.location?.origin ?? "http://localhost");
