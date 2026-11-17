// Applies generated SQL migrations from server/drizzle. Used in dev (pnpm db:migrate)
// and in the container before the server starts (node dist/migrate.js).
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "../env";

const client = postgres(env.DATABASE_URL, { max: 1 });

try {
  await migrate(drizzle(client), { migrationsFolder: env.MIGRATIONS_DIR });
  console.log(`Migrations applied from ${env.MIGRATIONS_DIR}`);
} finally {
  await client.end();
}
