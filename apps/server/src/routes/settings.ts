import { z } from "zod";
import { db, users, eq } from "@repo/db";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { badRequest, json, notFound, unauthorized, serverError } from "../http";

const log = createLogger("server:settings");

/**
 * Privacy / budget settings (spec 02 §2.6, §8).
 *
 * GET/PATCH /settings/privacy
 *  - transcriptRetentionDays: null = forever, 0 = digest immediately, N = days
 *  - quietHoursStart / quietHoursEnd: local times (HH:MM or HH:MM:SS)
 *  - maxDailySurfacings: proactive budget across channels
 */

const timeRe = /^([01]?\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;

function normalizeTime(t: string): string {
  const m = timeRe.exec(t.trim());
  if (!m) throw new Error("invalid time");
  const hh = m[1]!.padStart(2, "0");
  const mm = m[2]!;
  const ss = m[4] ?? "00";
  return `${hh}:${mm}:${ss}`;
}

/** Coerce a DB time value to HH:MM:SS string. */
function timeToString(v: unknown): string {
  if (typeof v === "string") {
    // Already "HH:MM:SS" or "HH:MM:SS.mmm"
    const base = v.slice(0, 8);
    if (timeRe.test(base.length === 5 ? `${base}:00` : base)) {
      return base.length === 5 ? `${base}:00` : base;
    }
    return v;
  }
  return String(v);
}

function serializePrivacy(row: {
  transcriptRetentionDays: number | null;
  quietHoursStart: unknown;
  quietHoursEnd: unknown;
  maxDailySurfacings: number;
}) {
  return {
    transcriptRetentionDays: row.transcriptRetentionDays,
    quietHoursStart: timeToString(row.quietHoursStart),
    quietHoursEnd: timeToString(row.quietHoursEnd),
    maxDailySurfacings: row.maxDailySurfacings,
  };
}

const PatchBody = z
  .object({
    transcriptRetentionDays: z
      .number()
      .int()
      .min(0)
      .max(3650)
      .nullable()
      .optional(),
    quietHoursStart: z.string().regex(timeRe, "quietHoursStart must be HH:MM[:SS]").optional(),
    quietHoursEnd: z.string().regex(timeRe, "quietHoursEnd must be HH:MM[:SS]").optional(),
    maxDailySurfacings: z.number().int().min(0).max(50).optional(),
  })
  .refine(
    (d) =>
      d.transcriptRetentionDays !== undefined ||
      d.quietHoursStart !== undefined ||
      d.quietHoursEnd !== undefined ||
      d.maxDailySurfacings !== undefined,
    { message: "At least one field is required." },
  );

export async function getPrivacySettings(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  try {
    const [row] = await db
      .select({
        transcriptRetentionDays: users.transcriptRetentionDays,
        quietHoursStart: users.quietHoursStart,
        quietHoursEnd: users.quietHoursEnd,
        maxDailySurfacings: users.maxDailySurfacings,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row) return notFound("User not found.");
    return json(serializePrivacy(row));
  } catch (err) {
    log.error("getPrivacySettings failed", err as Error);
    return serverError();
  }
}

export async function patchPrivacySettings(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest("Body must be valid JSON.");
  }
  const parsed = PatchBody.safeParse(raw);
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const patch: {
    transcriptRetentionDays?: number | null;
    quietHoursStart?: string;
    quietHoursEnd?: string;
    maxDailySurfacings?: number;
  } = {};

  if (parsed.data.transcriptRetentionDays !== undefined) {
    patch.transcriptRetentionDays = parsed.data.transcriptRetentionDays;
  }
  if (parsed.data.quietHoursStart !== undefined) {
    patch.quietHoursStart = normalizeTime(parsed.data.quietHoursStart);
  }
  if (parsed.data.quietHoursEnd !== undefined) {
    patch.quietHoursEnd = normalizeTime(parsed.data.quietHoursEnd);
  }
  if (parsed.data.maxDailySurfacings !== undefined) {
    patch.maxDailySurfacings = parsed.data.maxDailySurfacings;
  }

  try {
    const [row] = await db
      .update(users)
      .set(patch)
      .where(eq(users.id, userId))
      .returning({
        transcriptRetentionDays: users.transcriptRetentionDays,
        quietHoursStart: users.quietHoursStart,
        quietHoursEnd: users.quietHoursEnd,
        maxDailySurfacings: users.maxDailySurfacings,
      });

    if (!row) return notFound("User not found.");
    log.info("privacy settings updated", { userId, patch });
    return json(serializePrivacy(row));
  } catch (err) {
    log.error("patchPrivacySettings failed", err as Error);
    return serverError();
  }
}
