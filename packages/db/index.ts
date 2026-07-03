// @repo/db — Drizzle schema, client, and typed query helpers.
// Single import surface for apps/server, apps/worker, and @repo/core.
export * from "./client";
export * from "./schema";
export * from "./queries";

// Re-export common Drizzle SQL helpers so apps don't depend on drizzle-orm
// directly for simple query building.
export { sql, eq, and, or, desc, asc, isNull, inArray, gt, gte, lt, lte } from "drizzle-orm";
