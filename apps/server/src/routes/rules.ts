import { z } from "zod";
import { editRuleAsCorrection } from "@repo/core";
import { db, rules, eq, and, desc, sql } from "@repo/db";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { badRequest, json, notFound, unauthorized, serverError } from "../http";

const log = createLogger("server:rules");

/**
 * Standing rules API (spec 02 §8, P1).
 *
 * GET  /rules         — list (active first; appliedCount, lastAppliedAt)
 * PATCH /rules/:id    — { active } toggles metadata;
 *                       { ruleText? | triggerText? } is EDIT-AS-CORRECTION
 *                       (new memory + new rule row; old superseded, never mutated).
 */

function serializeRule(row: {
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
  return {
    id: row.id,
    ruleText: row.ruleText,
    triggerText: row.triggerText,
    active: row.active,
    sourceMemory: row.sourceMemory,
    appliedCount: row.applyCount,
    lastAppliedAt: row.lastAppliedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    supersededBy: row.supersededBy,
  };
}

/** GET /rules — active first, then by last applied / created. */
export async function listRules(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  try {
    const rows = await db
      .select({
        id: rules.id,
        ruleText: rules.ruleText,
        triggerText: rules.triggerText,
        active: rules.active,
        sourceMemory: rules.sourceMemory,
        applyCount: rules.applyCount,
        lastAppliedAt: rules.lastAppliedAt,
        createdAt: rules.createdAt,
        supersededBy: rules.supersededBy,
      })
      .from(rules)
      .where(eq(rules.userId, userId))
      .orderBy(
        // active first (true > false), then most recently applied, then newest.
        desc(rules.active),
        sql`${rules.lastAppliedAt} DESC NULLS LAST`,
        desc(rules.createdAt),
      )
      .limit(200);

    return json({ rules: rows.map(serializeRule) });
  } catch (err) {
    log.error("listRules failed", err as Error);
    return serverError();
  }
}

const PatchBody = z
  .object({
    active: z.boolean().optional(),
    ruleText: z.string().min(1).max(8000).optional(),
    triggerText: z.string().min(1).max(2000).optional(),
  })
  .refine(
    (d) =>
      d.active !== undefined ||
      d.ruleText !== undefined ||
      d.triggerText !== undefined,
    { message: "At least one of active, ruleText, or triggerText is required." },
  );

/** PATCH /rules/:id — toggle active and/or edit-as-correction. */
export async function patchRule(
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
  const parsed = PatchBody.safeParse(raw);
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }

  try {
    const [existing] = await db
      .select({
        id: rules.id,
        ruleText: rules.ruleText,
        triggerText: rules.triggerText,
        active: rules.active,
        sourceMemory: rules.sourceMemory,
        applyCount: rules.applyCount,
        lastAppliedAt: rules.lastAppliedAt,
        createdAt: rules.createdAt,
        supersededBy: rules.supersededBy,
      })
      .from(rules)
      .where(and(eq(rules.id, ruleId), eq(rules.userId, userId)))
      .limit(1);

    if (!existing) return notFound("Rule not found.");

    const wantsEdit =
      parsed.data.ruleText !== undefined ||
      parsed.data.triggerText !== undefined;

    // Edit-as-correction supersedes the old row. Active toggle on the *new*
    // row can still be applied after; if only active, update metadata in place.
    if (wantsEdit) {
      const result = await editRuleAsCorrection({
        userId,
        ruleId,
        ruleText: parsed.data.ruleText,
        triggerText: parsed.data.triggerText,
      });

      if (!result) {
        // No-op text (identical) — optionally still toggle active on old row.
        if (parsed.data.active === undefined) {
          return json(serializeRule(existing));
        }
      } else {
        let newRow = result.newRule;
        if (parsed.data.active !== undefined && parsed.data.active !== newRow.active) {
          const [updated] = await db
            .update(rules)
            .set({ active: parsed.data.active })
            .where(and(eq(rules.id, newRow.id), eq(rules.userId, userId)))
            .returning({
              id: rules.id,
              ruleText: rules.ruleText,
              triggerText: rules.triggerText,
              active: rules.active,
              sourceMemory: rules.sourceMemory,
              applyCount: rules.applyCount,
              lastAppliedAt: rules.lastAppliedAt,
              createdAt: rules.createdAt,
              supersededBy: rules.supersededBy,
            });
          if (updated) newRow = updated;
        }
        log.info("rule patched (edit-as-correction)", {
          userId,
          oldRuleId: result.oldRuleId,
          newRuleId: newRow.id,
        });
        return json(serializeRule(newRow));
      }
    }

    if (parsed.data.active !== undefined) {
      const [updated] = await db
        .update(rules)
        .set({ active: parsed.data.active })
        .where(and(eq(rules.id, ruleId), eq(rules.userId, userId)))
        .returning({
          id: rules.id,
          ruleText: rules.ruleText,
          triggerText: rules.triggerText,
          active: rules.active,
          sourceMemory: rules.sourceMemory,
          applyCount: rules.applyCount,
          lastAppliedAt: rules.lastAppliedAt,
          createdAt: rules.createdAt,
          supersededBy: rules.supersededBy,
        });
      if (!updated) return notFound("Rule not found.");
      log.info("rule active toggled", {
        userId,
        ruleId,
        active: updated.active,
      });
      return json(serializeRule(updated));
    }

    return json(serializeRule(existing));
  } catch (err) {
    log.error("patchRule failed", err as Error);
    return serverError();
  }
}
