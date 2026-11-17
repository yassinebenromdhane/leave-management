// Creates the test database if needed and applies all migrations once per test run.
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { TestProject } from "vitest/node";

export default async function setup(project: TestProject): Promise<void> {
  const url = project.config.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing in vitest env");
  const target = new URL(url);
  const dbName = target.pathname.replace(/^\//, "");
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*_test$/.test(dbName)) throw new Error(`Refusing to use "${dbName}" as a test database`);

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const adminClient = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    const exists = await adminClient`select 1 from pg_database where datname = ${dbName}`;
    if (exists.length === 0) await adminClient.unsafe(`create database "${dbName}"`);
  } finally {
    await adminClient.end();
  }

  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  } finally {
    await client.end();
  }
}
