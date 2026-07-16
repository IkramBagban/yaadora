import { z } from "zod";
import { db, pushTokens, eq, and } from "@repo/db";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { badRequest, json, unauthorized, serverError } from "../http";

const log = createLogger("server:push-tokens");

/**
 * Device push registration (spec 02 §2.6, §6, §8).
 *
 * POST /push-tokens — upsert by (user_id, device_id).
 */

const Body = z.object({
  deviceId: z.string().min(1, "deviceId is required").max(256),
  expoToken: z.string().min(1, "expoToken is required").max(512),
});

export async function registerPushToken(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest("Body must be valid JSON.");
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const { deviceId, expoToken } = parsed.data;
  const now = new Date();

  try {
    // Upsert on unique (user_id, device_id).
    const [existing] = await db
      .select({ id: pushTokens.id })
      .from(pushTokens)
      .where(and(eq(pushTokens.userId, userId), eq(pushTokens.deviceId, deviceId)))
      .limit(1);

    let row: { id: string; deviceId: string; updatedAt: Date };
    if (existing) {
      const [updated] = await db
        .update(pushTokens)
        .set({ expoToken, updatedAt: now })
        .where(eq(pushTokens.id, existing.id))
        .returning({
          id: pushTokens.id,
          deviceId: pushTokens.deviceId,
          updatedAt: pushTokens.updatedAt,
        });
      row = updated!;
    } else {
      const [created] = await db
        .insert(pushTokens)
        .values({ userId, deviceId, expoToken, updatedAt: now })
        .returning({
          id: pushTokens.id,
          deviceId: pushTokens.deviceId,
          updatedAt: pushTokens.updatedAt,
        });
      row = created!;
    }

    log.info("push token registered", { userId, deviceId: row.deviceId });
    return json({
      id: row.id,
      deviceId: row.deviceId,
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (err) {
    // Race on unique constraint — retry as update.
    try {
      const [updated] = await db
        .update(pushTokens)
        .set({ expoToken, updatedAt: now })
        .where(and(eq(pushTokens.userId, userId), eq(pushTokens.deviceId, deviceId)))
        .returning({
          id: pushTokens.id,
          deviceId: pushTokens.deviceId,
          updatedAt: pushTokens.updatedAt,
        });
      if (updated) {
        return json({
          id: updated.id,
          deviceId: updated.deviceId,
          updatedAt: updated.updatedAt.toISOString(),
        });
      }
    } catch {
      // fall through
    }
    log.error("registerPushToken failed", err as Error);
    return serverError();
  }
}
