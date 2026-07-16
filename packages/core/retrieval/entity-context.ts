import {
  getEntityContextCore,
  getOpenLoopsForEntity,
  getTopCurrentFactsForEntity,
  getOneHopEdges,
} from "@repo/db";

/**
 * Entity context assembler (spec 02 §5.2, spec 03 P3 item 2).
 *
 * `assembleEntityContext(userId, entityId)` gathers, in one round-trip of
 * parallel queries and NO LLM call:
 *   - profile               (entities.profile)
 *   - open loops            (status = 'open')
 *   - top current facts     (valid_to IS NULL, by salience, ≤8)
 *   - 1-hop edges           (by strength, ≤6; relType/status/lastMentioned +
 *                            whether the other endpoint is a known entity)
 *
 * Every item carries its provenance memory ids so downstream answers can cite.
 * The same assembler backs BOTH doorway modes: the pre-fetch into the context
 * pack and the callable `get_entity_context` tool (spec 02 §5.2).
 */

/** Cap on current facts assembled (spec 02 §5.2). */
export const ENTITY_FACT_CAP = 8;
/** Cap on 1-hop edges assembled (spec 02 §5.2). */
export const ENTITY_EDGE_CAP = 6;

export interface EntityContextLoop {
  id: string;
  kind: string;
  title: string;
  dueAt: string | null;
  /** provenance memory id */
  sourceMemory: string;
}

export interface EntityContextFact {
  id: string;
  predicate: string | null;
  factText: string;
  /** provenance memory id */
  sourceMemory: string;
}

export interface EntityContextEdge {
  id: string;
  relType: string;
  status: string;
  lastMentioned: string | null;
  otherId: string;
  otherName: string;
  otherType: string;
  otherIsKnownEntity: boolean;
  /** provenance memory ids */
  evidence: string[];
}

export interface EntityContext {
  entity: { id: string; canonicalName: string; type: string };
  profile: string | null;
  openLoops: EntityContextLoop[];
  facts: EntityContextFact[];
  edges: EntityContextEdge[];
  /** Union of every provenance memory id referenced above (receipts). */
  receipts: string[];
}

/**
 * Assemble an entity's context. Returns null when the entity does not exist or
 * is not owned by the user (ownership is enforced by the scoped queries).
 */
export async function assembleEntityContext(
  userId: string,
  entityId: string,
): Promise<EntityContext | null> {
  const [core, loops, facts, edges] = await Promise.all([
    getEntityContextCore(userId, entityId),
    getOpenLoopsForEntity(userId, entityId),
    getTopCurrentFactsForEntity(userId, entityId, ENTITY_FACT_CAP),
    getOneHopEdges(userId, entityId, ENTITY_EDGE_CAP),
  ]);
  if (!core) return null;

  const openLoops: EntityContextLoop[] = loops.map((l) => ({
    id: l.id,
    kind: l.kind,
    title: l.title,
    dueAt: l.dueAt ? l.dueAt.toISOString() : null,
    sourceMemory: l.sourceMemory,
  }));

  const factItems: EntityContextFact[] = facts.slice(0, ENTITY_FACT_CAP).map((f) => ({
    id: f.id,
    predicate: f.predicate,
    factText: f.factText,
    sourceMemory: f.sourceMemory,
  }));

  const edgeItems: EntityContextEdge[] = edges.slice(0, ENTITY_EDGE_CAP).map((e) => ({
    id: e.id,
    relType: e.relType,
    status: e.status,
    lastMentioned: e.lastMentioned ? e.lastMentioned.toISOString() : null,
    otherId: e.otherId,
    otherName: e.otherName,
    otherType: e.otherType,
    otherIsKnownEntity: e.otherIsKnownEntity,
    evidence: e.evidence,
  }));

  const receipts = Array.from(
    new Set<string>([
      ...openLoops.map((l) => l.sourceMemory),
      ...factItems.map((f) => f.sourceMemory),
      ...edgeItems.flatMap((e) => e.evidence),
    ]),
  ).filter(Boolean);

  return {
    entity: {
      id: core.id,
      canonicalName: core.canonicalName,
      type: core.type,
    },
    profile: core.profile,
    openLoops,
    facts: factItems,
    edges: edgeItems,
    receipts,
  };
}

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

/**
 * Render an assembled entity context as a compact, delimited block for the
 * context-pack system-prompt section (spec 02 §4/§5.2) and the tool result.
 * Provenance memory ids ride along inline so the model can ground its reply.
 */
export function renderEntityContext(ctx: EntityContext): string {
  const lines: string[] = [];
  lines.push(`— ${ctx.entity.canonicalName} (${ctx.entity.type}) —`);
  if (ctx.profile) lines.push(`Profile: ${ctx.profile}`);

  if (ctx.openLoops.length) {
    lines.push("Open threads:");
    for (const l of ctx.openLoops) {
      const due = l.dueAt ? ` (due ${fmtDate(l.dueAt)})` : "";
      lines.push(`  • [${l.kind}] ${l.title}${due} [${l.sourceMemory}]`);
    }
  }

  if (ctx.facts.length) {
    lines.push("Current facts:");
    for (const f of ctx.facts) {
      lines.push(`  • ${f.factText} [${f.sourceMemory}]`);
    }
  }

  if (ctx.edges.length) {
    lines.push("Connections:");
    for (const e of ctx.edges) {
      const last = e.lastMentioned ? `, last ${fmtDate(e.lastMentioned)}` : "";
      const refs = e.evidence.length ? ` [${e.evidence.join(", ")}]` : "";
      lines.push(
        `  • ${e.relType} ${e.otherName} (${e.otherType}) — ${e.status}${last}${refs}`,
      );
    }
  }

  return lines.join("\n");
}
