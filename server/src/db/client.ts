import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

// postgres.js connects lazily on the first query, so importing this module never opens a socket.
export const sql = postgres(env.DATABASE_URL, { max: 10 });

export const db = drizzle(sql, { schema, casing: "snake_case" });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
