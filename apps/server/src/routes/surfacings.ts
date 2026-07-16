import { z } from "zod";
import { db, surfacings, eq, and } from "@repo/db";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { badRequest, json, notFound, unauthorized, serverError } from "../http";

const log = createLogger("server:surfacings");

/**
 * Surfacing ledger reactions (spec 02 §2.4, §8).
 *
 * POST /surfacings/:id/reaction — { reaction: dismissed | engaged }
 * Writes reaction + reaction_at; scoped to the authenticated user.
 */

const ReactionBody = z.object({
  reaction: z.enum(["dismissed", "engaged"]),
});

export async function postSurfacingReaction(
  req: Request,
  surfacingId: string,
): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  if (!surfacingId || !z.string().uuid().safeParse(surfacingId).success) {
    return badRequest("surfacing id must be a uuid.");
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest("Body must be valid JSON.");
  }
  const parsed = ReactionBody.safeParse(raw);
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }

  try {
    const [row] = await db
      .update(surfacings)
      .set({
        reaction: parsed.data.reaction,
        reactionAt: new Date(),
      })
      .where(and(eq(surfacings.id, surfacingId), eq(surfacings.userId, userId)))
      .returning({
        id: surfacings.id,
        reaction: surfacings.reaction,
        reactionAt: surfacings.reactionAt,
      });

    if (!row) return notFound("Surfacing not found.");
    log.info("surfacing reaction recorded", {
      userId,
      surfacingId: row.id,
      reaction: row.reaction,
    });
    return json({
      id: row.id,
      reaction: row.reaction,
      reactionAt: row.reactionAt?.toISOString() ?? null,
    });
  } catch (err) {
    log.error("postSurfacingReaction failed", err as Error);
    return serverError();
  }
}
