import { db, users, eq } from "@repo/db";

/**
 * Single-user bootstrap (spec 03 §1.4). v0 is single-user, but every row is
 * already `user_id`-scoped, so going multi-user later is a drop-in: replace this
 * seed + the token→user mapping in `auth.ts` with real user records.
 *
 * Seeds one user from env (idempotent — safe to run on every boot).
 */
const SEED_EMAIL = process.env.SEED_USER_EMAIL ?? "owner@yaadora.local";
const SEED_TIMEZONE = process.env.SEED_USER_TIMEZONE ?? "UTC";

export async function seedUser(): Promise<string> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, SEED_EMAIL))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(users)
    .values({ email: SEED_EMAIL, timezone: SEED_TIMEZONE })
    .returning({ id: users.id });
  return created!.id;
}
