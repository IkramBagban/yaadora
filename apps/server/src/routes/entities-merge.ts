import { z } from "zod";
import { mergeEntities } from "@repo/db";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { badRequest, json, notFound, unauthorized, serverError } from "../http";

const log = createLogger("server:entities-merge");

/**
 * POST /entities/merge — fold a duplicate entity into its primary
 * (backend-gaps wave).
 *
 * Body: { primaryId, duplicateId }. Both must be the user's entities and
 * distinct. The remap (memory_entities, facts subject/object,
 * open_loops.entity_id, entity_edges) runs in one transaction inside
 * @repo/db/queries/entities-merge; aliases are unioned and mention counts
 * folded. Derived edges touching the duplicate are dropped — the nightly
 * rebuild re-derives merged edges from the remapped facts.
 */

const MergeBody = z
  .object({
    primaryId: z.string().uuid(),
    duplicateId: z.string().uuid(),
  })
  .refine((d) => d.primaryId !== d.duplicateId, {
    message: "primaryId and duplicateId must be different.",
  });

export async function postEntitiesMerge(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest("Body must be valid JSON.");
  }
  const parsed = MergeBody.safeParse(raw);
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const { primaryId, duplicateId } = parsed.data;

  try {
    const result = await mergeEntities(userId, primaryId, duplicateId);
    if (!result) {
      return notFound(
        "Merge failed: both ids must reference distinct entities you own.",
      );
    }
    log.info("entities merged", {
      userId,
      primaryId,
      duplicateId,
      remapped: result.remapped,
    });
    return json(result);
  } catch (err) {
    log.error("postEntitiesMerge failed", err as Error);
    return serverError();
  }
}
