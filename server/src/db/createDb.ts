// Creates the database named in DATABASE_URL if it does not exist yet.
// For local development against an existing PostgreSQL install (no Docker).
// Connects to the "postgres" maintenance database with the same credentials.
import postgres from "postgres";
import { env } from "../env";

const target = new URL(env.DATABASE_URL);
const dbName = decodeURIComponent(target.pathname.replace(/^\//, ""));
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
  throw new Error(`Refusing to create database with unsafe name: "${dbName}"`);
}

const admin = new URL(env.DATABASE_URL);
admin.pathname = "/postgres";
const client = postgres(admin.toString(), { max: 1, onnotice: () => {} });

try {
  const rows = await client`select 1 from pg_database where datname = ${dbName}`;
  if (rows.length > 0) {
    console.log(`Database "${dbName}" already exists`);
  } else {
    await client.unsafe(`create database "${dbName}"`);
    console.log(`Database "${dbName}" created`);
  }
} finally {
  await client.end();
}
