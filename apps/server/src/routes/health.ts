import { db, sql } from "@repo/db";
import { createLogger } from "@repo/logger";
import { json } from "../http";

const log = createLogger("server:health");

/** GET /health → { ok, db, redis } (spec 03 §1.5). Unauthenticated. */
export async function health(): Promise<Response> {
  const [dbOk, redisOk] = await Promise.all([checkDb(), checkRedis()]);
  const ok = dbOk && redisOk;
  if (!ok) log.warn("health check degraded", { db: dbOk, redis: redisOk });
  return json({ ok, db: dbOk, redis: redisOk }, ok ? 200 : 503);
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

async function checkRedis(): Promise<boolean> {
  try {
    const pong = await Bun.redis.ping();
    return pong === "PONG" || pong === "pong" || Boolean(pong);
  } catch (err) {
    log.error("redis health check failed", err as any);
    return false;
  }
}
