import { z } from "zod";
import { editRuleAsCorrection } from "@repo/core";
import { db, rules, eq, and, desc, isNull, sql } from "@repo/db";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import {
  badRequest,
  conflict,
  json,
  notFound,
  unauthorized,
  serverError,
} from "../http";

const log = createLogger("server:rules");

/**
 * Standing rules API (spec 02 §8, P1).
 *
 * GET  /rules         — list head rules only (superseded_by IS NULL);
 *                       active first; appliedCount, lastAppliedAt
 * PATCH /rules/:id    — { active } toggles metadata on a head rule;
 *                       { ruleText? | triggerText? } is EDIT-AS-CORRECTION
 *                       (new memory + new rule row; old superseded, never mutated).
 * Superseded historical rows are not listed and cannot be reactivated or edited.
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

/** GET /rules — head rules only, active first, then by last applied / created. */
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
      .where(and(eq(rules.userId, userId), isNull(rules.supersededBy)))
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

/** PATCH /rules/:id — toggle active and/or edit-as-correction (head rules only). */
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

    // Historical versions are immutable and not reactivatable (prevents dual
    // active rules with overlapping triggers).
    if (existing.supersededBy) {
      return conflict(
        "This rule was superseded by a newer version and cannot be edited or reactivated. Use the current rule instead.",
      );
    }

    const wantsEdit =
      parsed.data.ruleText !== undefined ||
      parsed.data.triggerText !== undefined;

    // Edit-as-correction supersedes the old row. Active toggle on the *new*
    // row can still be applied after; if only active, update metadata in place.
    if (wantsEdit) {
      let result;
      try {
        result = await editRuleAsCorrection({
          userId,
          ruleId,
          ruleText: parsed.data.ruleText,
          triggerText: parsed.data.triggerText,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("concurrent edit")) {
          return conflict(
            "Rule was updated concurrently; refresh and retry against the current version.",
          );
        }
        throw err;
      }

      if (!result) {
        // No-op text (identical) or race where row became superseded — optionally
        // still toggle active on the old head row.
        if (parsed.data.active === undefined) {
          return json(serializeRule(existing));
        }
      } else {
        let newRow = result.newRule;
        if (
          parsed.data.active !== undefined &&
          parsed.data.active !== newRow.active
        ) {
          const [updated] = await db
            .update(rules)
            .set({ active: parsed.data.active })
            .where(
              and(
                eq(rules.id, newRow.id),
                eq(rules.userId, userId),
                isNull(rules.supersededBy),
              ),
            )
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
        .where(
          and(
            eq(rules.id, ruleId),
            eq(rules.userId, userId),
            isNull(rules.supersededBy),
          ),
        )
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
      if (!updated) {
        // Became superseded between select and update.
        return conflict(
          "This rule was superseded by a newer version and cannot be edited or reactivated.",
        );
      }
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
