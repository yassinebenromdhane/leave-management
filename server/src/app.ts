// API route tree. Keep routes chained so `AppType` carries every route to hono/client in web/.
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { env } from "./env";
import { DomainError } from "./domain/errors";
import { eventRoutes } from "./routes/events";
import { fileRoutes } from "./routes/files";
import { operatorRoutes } from "./routes/operator";
import { portalRoutes } from "./routes/portal/me";
import { sessionRoutes } from "./routes/session";

const app = new Hono()
  .basePath("/api")
  // Rejects cross-site form posts. JSON requests are also protected by CORS preflight
  // (no CORS headers are ever sent).
  .use(csrf({ origin: env.APP_URL }))
  .get("/health", (c) => c.json({ status: "ok" as const }))
  .route("/session", sessionRoutes)
  .route("/operator", operatorRoutes)
  .route("/files", fileRoutes)
  .route("/me", portalRoutes)
  .route("/events", eventRoutes);

// Unexpected errors: log the message only (never query parameters, which can hold emails or
// hashes) and answer with a generic code.
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse(); // e.g. CSRF 403
  if (err instanceof DomainError) {
    return c.json({ code: err.code, ...(err.params ? { params: err.params } : {}), ...err.extra }, err.status);
  }
  console.error(`[api] ${c.req.method} ${c.req.path}: ${err.name}: ${err.message.split("\n")[0]?.slice(0, 200)}`);
  return c.json({ code: "errors.generic" }, 500);
});

export type AppType = typeof app;
export default app;
