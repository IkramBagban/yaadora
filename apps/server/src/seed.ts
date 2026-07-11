import { db, users, eq } from "@repo/db";
import { createLogger } from "@repo/logger";

const log = createLogger("server:seed");

/**
 * Bootstrap user for local eval/seed scripts only.
 * Enabled when AUTH_ALLOW_BOOTSTRAP=true. Production should not use this.
 */
const SEED_EMAIL = process.env.SEED_USER_EMAIL ?? "owner@yaadora.local";
const SEED_TIMEZONE = process.env.SEED_USER_TIMEZONE ?? "UTC";

export async function ensureBootstrapUser(): Promise<string> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, SEED_EMAIL))
    .limit(1);
  if (existing) {
    log.debug("bootstrap user already exists", { email: SEED_EMAIL });
    return existing.id;
  }

  const [created] = await db
    .insert(users)
    .values({ email: SEED_EMAIL, timezone: SEED_TIMEZONE })
    .returning({ id: users.id });
  log.info("bootstrap user created", {
    email: SEED_EMAIL,
    timezone: SEED_TIMEZONE,
    userId: created!.id,
  });
  return created!.id;
}
