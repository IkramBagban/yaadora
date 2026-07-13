import { createLogger } from "@repo/logger";

const log = createLogger("server:redis");

/**
 * Lazy singleton Redis client that reads REDIS_URL from env.
 * Falls back to Bun.redis default (localhost:6379) if not set.
 */
let _client: InstanceType<typeof Bun.RedisClient> | null = null;

export function getRedis(): InstanceType<typeof Bun.RedisClient> {
  if (!_client) {
    const url = process.env.REDIS_URL;
    if (url) {
      _client = new Bun.RedisClient(url);
      log.info("Redis client connected", { url: url.replace(/\/\/.*@/, "//<redacted>@") });
    } else {
      log.warn("REDIS_URL not set, using Bun.redis default (localhost:6379)");
      _client = Bun.redis as any;
    }
  }
  return _client!;
}
