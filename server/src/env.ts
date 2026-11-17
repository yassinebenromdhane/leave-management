import { z } from "zod";
import { loadRootEnv } from "./loadEnv";

loadRootEnv();

const isProd = process.env.NODE_ENV === "production";

/** Development-only signing secret. Production refuses to start without BETTER_AUTH_SECRET. */
const DEV_AUTH_SECRET = "dev-only-insecure-secret-change-me-0123456789";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: isProd
    ? z.string().url()
    : z.string().url().default("postgres://leave:leave@127.0.0.1:5432/leave"),
  WEB_DIST: z.string().default("../web/dist"),
  UPLOAD_DIR: z.string().default("../uploads"),
  MIGRATIONS_DIR: z.string().default("./drizzle"),
  SEED_LOCALE: z.enum(["fr", "en"]).default("fr"),

  // "1" behind Caddy: trust X-Forwarded-For for the client IP (rate limiting).
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),

  // Public origin of the web app (used for cookies, CSRF/origin checks and links in emails).
  APP_URL: isProd ? z.string().url() : z.string().url().default("http://localhost:5173"),
  BETTER_AUTH_SECRET: isProd ? z.string().min(32) : z.string().min(32).default(DEV_AUTH_SECRET),

  // First operator account, created by db:seed when both are set.
  OPERATOR_EMAIL: optional,
  OPERATOR_INITIAL_PASSWORD: optional,

  // Brevo SMTP. Without SMTP_HOST outside production, emails are logged to the console.
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: optional,
  SMTP_PASSWORD: optional,
  MAIL_FROM: z.string().default("Leave <no-reply@localhost>"),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);

if (!isProd && env.BETTER_AUTH_SECRET === DEV_AUTH_SECRET && env.NODE_ENV !== "test") {
  console.warn("[auth] Using the development BETTER_AUTH_SECRET. Set BETTER_AUTH_SECRET in .env.");
}
