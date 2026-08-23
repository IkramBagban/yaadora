/**
 * Local user resolution: Clerk identity → `users.id`.
 *
 * Every protected route scopes data by the returned UUID. First authenticated
 * request upserts a row keyed by `clerk_user_id`.
 */

import { db, users, eq } from "@repo/db";
import { createLogger } from "@repo/logger";

const log = createLogger("server:users");

/**
 * Admin bootstrap (issue #30): emails listed in ADMIN_EMAILS (comma-separated,
 * case-insensitive) are provisioned with role='admin'. Promotion happens only
 * at provisioning — changing the env later never demotes existing admins and
 * does not retro-promote existing users.
 */
function isAdminEmail(email: string): boolean {
  const raw = process.env.ADMIN_EMAILS;
  if (!raw || raw.trim().length === 0) return false;
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
    .includes(email.toLowerCase());
}

export async function resolveLocalUserId(
  clerkUserId: string,
  email: string,
  timezoneHint?: string,
): Promise<string> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);

  if (existing) {
    log.debug("resolved existing local user", {
      userId: existing.id,
      clerkUserId,
    });
    return existing.id;
  }

  const timezone =
    timezoneHint && timezoneHint.trim().length > 0
      ? timezoneHint.trim()
      : "UTC";

  log.info("creating local user from Clerk", {
    clerkUserId,
    email: email.toLowerCase(),
    timezone,
  });

  try {
    const [created] = await db
      .insert(users)
      .values({
        clerkUserId,
        email: email.toLowerCase(),
        timezone,
        role: isAdminEmail(email) ? "admin" : "user",
      })
      .returning({ id: users.id });

    log.info("created local user from Clerk", {
      userId: created!.id,
      clerkUserId,
      email: email.toLowerCase(),
      timezone,
      admin: isAdminEmail(email),
    });
    return created!.id;
  } catch (err) {
    // Race: concurrent first requests for the same Clerk user (unique clerk_user_id).
    const [again] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId))
      .limit(1);
    if (again) {
      log.debug("resolved local user after insert race", {
        userId: again.id,
        clerkUserId,
      });
      return again.id;
    }

    // Email unique conflict with a legacy bootstrap row — try email match + link.
    const [byEmail] = await db
      .select({ id: users.id, clerkUserId: users.clerkUserId })
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);
    if (byEmail && !byEmail.clerkUserId) {
      await db
        .update(users)
        // Admin bootstrap also applies when linking a legacy bootstrap row.
        .set({
          clerkUserId,
          ...(isAdminEmail(email) ? { role: "admin" as const } : {}),
        })
        .where(eq(users.id, byEmail.id));
      log.info("linked Clerk id to existing email user", {
        userId: byEmail.id,
        clerkUserId,
        email: email.toLowerCase(),
      });
      return byEmail.id;
    }

    log.error(
      "failed to resolve local user",
      err instanceof Error
        ? err
        : new Error(typeof err === "string" ? err : "unknown user resolve error"),
    );
    log.warn("user resolve context", {
      clerkUserId,
      email: email.toLowerCase(),
    });
    throw err;
  }
}

export async function getUserById(userId: string) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      timezone: users.timezone,
      createdAt: users.createdAt,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export async function updateUserTimezone(
  userId: string,
  timezone: string,
): Promise<{
  id: string;
  email: string;
  timezone: string;
  createdAt: Date;
  role: "user" | "admin";
} | null> {
  const [row] = await db
    .update(users)
    .set({ timezone })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      email: users.email,
      timezone: users.timezone,
      createdAt: users.createdAt,
      role: users.role,
    });
  return row ?? null;
}
