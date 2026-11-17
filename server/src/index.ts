import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import api from "./app";
import { env } from "./env";

const root = new Hono();

root.route("/", api);

// Unknown /api paths are API 404s, never the SPA.
root.all("/api/*", (c) => c.json({ code: "errors.notFound" }, 404));

// Built React app: static assets, then SPA fallback for "/", "/me/*", "/leave/:id", …
root.use("/*", serveStatic({ root: env.WEB_DIST }));
root.get("*", serveStatic({ root: env.WEB_DIST, path: "index.html" }));

serve({ fetch: root.fetch, port: env.PORT }, (info) => {
  console.log(`Leave app listening on http://localhost:${info.port}`);
});
