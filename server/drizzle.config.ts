import { defineConfig } from "drizzle-kit";
import { loadRootEnv } from "./src/loadEnv";

loadRootEnv();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://leave:leave@127.0.0.1:5432/leave",
  },
});
