import { z } from "zod";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import {
  badRequest,
  json,
  notFound,
  unauthorized,
  serverError,
} from "../http";
import { getUserById, updateUserTimezone } from "../users";

const log = createLogger("server:me");

const PatchBody = z.object({
  timezone: z
    .string()
    .min(1, "timezone is required")
    .max(64)
    .regex(/^[A-Za-z0-9_+\-\/]+$/, "timezone must be an IANA-like string"),
});

function serializeUser(row: {
  id: string;
  email: string;
  timezone: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    email: row.email,
    timezone: row.timezone,
    createdAt: row.createdAt.toISOString(),
  };
}

/** GET /me — current authenticated user profile. */
export async function getMe(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  try {
    const row = await getUserById(userId);
    if (!row) return notFound("User not found.");
    return json(serializeUser(row));
  } catch (err) {
    log.error("getMe failed", err as Error);
    return serverError();
  }
}

/** PATCH /me — update timezone (and future profile fields). */
export async function patchMe(req: Request): Promise<Response> {
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
    const message = parsed.error.issues.map((i) => i.message).join("; ");
    return badRequest(message);
  }

  try {
    const row = await updateUserTimezone(userId, parsed.data.timezone);
    if (!row) return notFound("User not found.");
    log.info("user timezone updated", {
      userId,
      timezone: parsed.data.timezone,
    });
    return json(serializeUser(row));
  } catch (err) {
    log.error("patchMe failed", err as Error);
    return serverError();
  }
}
