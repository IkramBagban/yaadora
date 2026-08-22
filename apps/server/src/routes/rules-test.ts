import { z } from "zod";
import { embedText, RULE_SIMILARITY_THRESHOLD } from "@repo/core";
import { db, rules, eq, and, sql } from "@repo/db";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import {
  badRequest,
  json,
  notFound,
  unauthorized,
  serverError,
} from "../http";

const log = createLogger("server:rules-test");

/**
 * POST /rules/:id/test — "would this rule fire on this text?" dry-run
 * (backend-gaps wave).
 *
 * Embeds the probe text with the same embeddings helper the turn-time matcher
 * uses (@repo/core embedText), computes cosine similarity against the rule's
 * stored trigger_embedding, and reports whether it would clear the matcher
 * threshold (0.45, strict >, mirroring filterRuleCandidates in
 * @repo/core/retrieval/rule-matcher). No state is written; the LLM confirm
 * step of the live matcher is NOT run here — this tests the embedding gate
 * only.
 */

const TestBody = z.object({
  text: z.string().trim().min(1, "text is required").max(4000),
});

export async function testRuleRoute(
  req: Request,
  ruleId: string,
): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  if (!ruleId || !z.string().uuid().safeParse(ruleId).success) {
    return badRequest("rule id must be a uuid.");
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest("Body must be valid JSON.");
  }
  const parsed = TestBody.safeParse(raw);
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }

  try {
    const [rule] = await db
      .select({
        id: rules.id,
        active: rules.active,
        triggerText: rules.triggerText,
        supersededBy: rules.supersededBy,
      })
      .from(rules)
      .where(and(eq(rules.id, ruleId), eq(rules.userId, userId)))
      .limit(1);
    if (!rule) return notFound("Rule not found.");

    if (rule.supersededBy) {
      log.debug("rule test against historical version", {
        userId,
        ruleId,
      });
    }

    // Embed the probe with the shared helper (same provider/dimensions as
    // extraction-time trigger embeddings).
    let vector: string;
    try {
      const { embedding } = await embedText(parsed.data.text);
      if (!embedding.length) {
        throw new Error("empty embedding");
      }
      vector = `[${embedding.join(",")}]`;
    } catch (err) {
      log.warn("rule test embedding unavailable", {
        userId,
        ruleId,
        message: err instanceof Error ? err.message : String(err),
      });
      return json({
        ruleId,
        score: null,
        wouldFire: false,
        threshold: RULE_SIMILARITY_THRESHOLD,
        reason:
          "Embedding provider unavailable — cannot evaluate the trigger match.",
      });
    }

    const rows = await db.execute(sql`
      SELECT (trigger_embedding <=> ${vector}::vector) AS distance
      FROM rules
      WHERE id = ${ruleId}::uuid AND user_id = ${userId}
        AND trigger_embedding IS NOT NULL
      LIMIT 1
    `);
    const row = (rows as unknown as Array<Record<string, unknown>>)[0];
    if (!row) {
      return json({
        ruleId,
        score: null,
        wouldFire: false,
        threshold: RULE_SIMILARITY_THRESHOLD,
        reason: "Rule has no trigger embedding yet (extraction pending?).",
      });
    }

    // Cosine similarity = 1 - pgvector cosine distance.
    const score = Math.max(-1, Math.min(1, 1 - Number(row.distance)));
    const wouldFire = score > RULE_SIMILARITY_THRESHOLD && rule.active;

    log.info("rule tested", { userId, ruleId, score, wouldFire });
    return json({
      ruleId,
      score,
      wouldFire,
      threshold: RULE_SIMILARITY_THRESHOLD,
      ruleActive: rule.active,
      triggerText: rule.triggerText,
    });
  } catch (err) {
    log.error("testRule failed", err as Error);
    return serverError();
  }
}
