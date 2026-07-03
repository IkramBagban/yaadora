import { customType } from "drizzle-orm/pg-core";

/**
 * Postgres `tsvector` column type.
 *
 * Drizzle has no native tsvector type. We model it as a custom type so the
 * generated column + GIN index (spec 01 §4) is expressible in the schema and
 * types stay sound for the raw-SQL retrieval helpers. The actual column is a
 * `GENERATED ALWAYS AS (...) STORED` column (see `memories.fts`).
 */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});
