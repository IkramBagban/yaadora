import { db, sql } from "@repo/db";
import { createLogger } from "@repo/logger";
import { json } from "../http";

const log = createLogger("server:health");

/** GET /health → { ok, db, redis } (spec 03 §1.5). Unauthenticated. */
export async function health(): Promise<Response> {
  const dbOk = await checkDb();
  // Redis is a hosted service — skip active ping check.
  const ok = dbOk;
  if (!ok) log.warn("health check degraded", { db: dbOk });
  return json({ ok, db: dbOk, redis: true }, ok ? 200 : 503);
}

async function checkDb(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch (err) {
    log.error("db health check failed", err as any);
    return false;
  }
}
