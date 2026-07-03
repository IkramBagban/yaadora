import { db, sql } from "@repo/db";
import { json } from "../http";

/** GET /health → { ok, db, redis } (spec 03 §1.5). Unauthenticated. */
export async function health(): Promise<Response> {
  const [dbOk, redisOk] = await Promise.all([checkDb(), checkRedis()]);
  const ok = dbOk && redisOk;
  return json({ ok, db: dbOk, redis: redisOk }, ok ? 200 : 503);
}

async function checkDb(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(): Promise<boolean> {
  try {
    const pong = await Bun.redis.ping();
    return pong === "PONG" || pong === "pong" || Boolean(pong);
  } catch {
    return false;
  }
}
