import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * DB client — Drizzle over the postgres.js (postgres) driver.
 * Recommended driver for pgvector + migrations (spec 01 §2).
 * Bun auto-loads `.env`; DATABASE_URL is the only required var here.
 */
const connectionString =
  process.env.DATABASE_URL ||
  (process.env.NODE_ENV === "test"
    ? "postgres://fake:fake@localhost:5432/fake"
    : undefined);

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Bun auto-loads .env — see .env.example.");
}

// Single shared connection pool for the process.
export const queryClient = postgres(connectionString);

export const db = drizzle(queryClient, { schema });

export type DB = typeof db;
