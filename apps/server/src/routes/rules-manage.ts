import { z } from "zod";
import { embedText, enqueueIngestion } from "@repo/core";
import {
  db,
  memories,
  rules,
  sql,
} from "@repo/db";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { badRequest, json, notFound, unauthorized, serverError } from "../http";
import { serializeRule } from "./rules";

const log = createLogger("server:rules-manage");

/**
 * Rules manager additions (issue #12) — thin wrappers over @repo/db.
 *
 * POST /rules             — create a brand-new standing rule manually
 *                           (memory + rule row, same immutability/provenance
 *                           pattern as edit-as-correction in @repo/core).
 * GET  /rules/:id/history — supersession chain for a head rule: every version
 *                           whose superseded_by link reaches the rule, newest
 *                           first. Historical rows are read-only by design.
 */

const CreateBody = z.object({
  ruleText: z.string().trim().min(1, "ruleText is required").max(8000),
  triggerText: z.string().trim().min(1, "triggerText is required").max(2000),
});

/** POST /rules — manual standing-rule creation. */
export async function createRule(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest("Body must be valid JSON.");
  }
  const parsed = CreateBody.safeParse(raw);
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }

  try {
    // Embed outside the write path (network I/O); a missing embedding only
    // delays matching — the matcher skips rules without one.
    const { embedding } = await embedText(parsed.data.triggerText);

    const result = await db.transaction(async (tx) => {
      // Provenance: a rule always arrives via a memory (schema invariant).
      const [memory] = await tx
        .insert(memories)
        .values({
          userId,
          rawText: parsed.data.ruleText,
          source: "manual",
          status: "pending",
        })
        .returning({ id: memories.id });
      if (!memory) throw new Error("Failed to insert memory for manual rule.");

      const [created] = await tx
        .insert(rules)
        .values({
          userId,
          ruleText: parsed.data.ruleText,
          triggerText: parsed.data.triggerText,
          triggerEmbedding: embedding.length ? embedding : null,
          active: true,
          sourceMemory: memory.id,
        })
        .returning();
      if (!created) throw new Error("Failed to insert manual rule.");
      return { created, memoryId: memory.id };
    });

    // Best-effort ingestion of the provenance memory for facts/entities.
    try {
      await enqueueIngestion(result.memoryId);
    } catch (err) {
      log.warn("enqueue ingestion after manual rule failed (ignored)", err as Error);
    }

    log.info("manual rule created", { userId, ruleId: result.created.id });
    return json({ rule: serializeRule(result.created) }, 201);
  } catch (err) {
    log.error("createRule failed", err as Error);
    return serverError();
  }
}

/** One row of the supersession chain, serialized like StandingRule. */
function serializeVersion(row: {
  id: string;
  ruleText: string;
  triggerText: string;
  active: boolean;
  sourceMemory: string;
  applyCount: number;
  lastAppliedAt: Date | null;
  createdAt: Date;
  supersededBy: string | null;
}) {
  return serializeRule(row);
}

/** GET /rules/:id/history — full supersession chain containing the rule. */
export async function ruleHistory(
  req: Request,
  ruleId: string,
): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  if (!ruleId || !z.string().uuid().safeParse(ruleId).success) {
    return badRequest("rule id must be a uuid.");
  }

  try {
    // Walk the chain from the requested rule in both directions:
    // ancestors point at it via superseded_by; the requested rule may itself
    // be historical (its forward links resolve naturally).
    const rows = await db.execute(sql`
      WITH RECURSIVE chain AS (
        SELECT r.* FROM rules r
        WHERE r.id = ${ruleId}::uuid AND r.user_id = ${userId}
        UNION
        SELECT r.* FROM rules r
        JOIN chain c ON r.superseded_by = c.id
      )
      SELECT id, rule_text, trigger_text, active, source_memory,
             apply_count, last_applied_at, created_at, superseded_by
      FROM chain
      ORDER BY created_at DESC
      LIMIT 100
    `);

    const list = rows as unknown as Array<{
      id: string;
      rule_text: string;
      trigger_text: string;
      active: boolean;
      source_memory: string;
      apply_count: number;
      last_applied_at: string | null;
      created_at: string;
      superseded_by: string | null;
    }>;

    if (!list.length) return notFound("Rule not found.");

    const items = list.map((row) =>
      serializeVersion({
        id: row.id,
        ruleText: row.rule_text,
        triggerText: row.trigger_text,
        active: row.active,
        sourceMemory: row.source_memory,
        applyCount: Number(row.apply_count),
        lastAppliedAt: row.last_applied_at ? new Date(row.last_applied_at) : null,
        createdAt: new Date(row.created_at),
        supersededBy: row.superseded_by,
      }),
    );

    return json({ items });
  } catch (err) {
    log.error("ruleHistory failed", err as Error);
    return serverError();
  }
}
