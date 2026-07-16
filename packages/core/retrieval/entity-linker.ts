import {
  listLinkableEntities,
  entityEmbeddingDistances,
  type LinkableEntity,
} from "@repo/db";
import { createLogger } from "@repo/logger";
import { embedText } from "../ai/models";
import { decideEntityLink, type LinkCandidate } from "../ingestion/linking";

/**
 * Turn-time entity linker (spec 02 §5.2, spec 03 P3) — the graph doorway's
 * trigger. Given a user turn, resolve which KNOWN entities it mentions, so the
 * agent can pre-fetch their context.
 *
 * This is a READ path: a wrong link shows the user *someone else's* context, so
 * we prefer NO link over a guess. Resolution reuses the ingestion linking
 * decision (`decideEntityLink`) with the SAME thresholds — the read and write
 * paths cannot drift. Alias/lexical match first; embedding similarity only to
 * break a same-name ambiguity. NO new entities are ever created here.
 *
 * Steps:
 *  1. Load the user's entities (names + aliases; a few thousand at most).
 *  2. Whole-word scan of the turn for each name/alias → surface → matching ids.
 *  3. One match → confident (exact). Several entities share the surface (e.g.
 *     two people named "Urhan") → embed the turn once and let `decideEntityLink`
 *     pick only if ONE candidate is confidently closest; else no link.
 *  4. Order by appearance, cap at 2 entities per turn (spec 02 §5.2).
 */

const log = createLogger("retrieval:entity-linker");

/** Max entities linked per turn (spec 02 §5.2). */
export const TURN_ENTITY_CAP = 2;
/** Names shorter than this are ignored as linking fodder (noise guard). */
const MIN_NAME_LEN = 2;

export interface LinkedEntity {
  entityId: string;
  canonicalName: string;
  type: string;
  /** the surface form matched in the turn */
  surface: string;
  /** how the link was resolved */
  via: "exact" | "embedding";
}

export interface LinkTurnEntitiesParams {
  userId: string;
  userTurn: string;
  /** Cap; defaults to 2 (spec 02 §5.2). */
  cap?: number;
  /**
   * Turn embedder for same-name disambiguation. Injectable for hermetic tests;
   * defaults to the production embedding model. Only called when an ambiguity
   * actually needs breaking (keeps the common path embedding-free).
   */
  embedTurn?: (text: string) => Promise<number[]>;
  /** Pre-loaded entities (tests / caching); defaults to a DB scan. */
  entities?: LinkableEntity[];
}

/** Escape a string for safe use as a literal inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-word (Unicode-aware) match of `name` in `text`, tolerant of a trailing
 * possessive ("Rahul's"). Returns the index of the first match, or -1.
 */
function firstWordMatchIndex(text: string, name: string): number {
  const esc = escapeRegExp(name);
  let re: RegExp;
  try {
    re = new RegExp(`(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`, "iu");
  } catch {
    // Environment without lookbehind/unicode props — fall back to a plain
    // case-insensitive search bounded by non-word chars.
    re = new RegExp(`(^|[^\\w])${esc}([^\\w]|$)`, "i");
  }
  const m = re.exec(text);
  return m ? m.index : -1;
}

interface SurfaceMatch {
  surface: string;
  index: number;
  entityIds: string[];
}

/**
 * Resolve the known entities mentioned in a user turn. Confident links only,
 * capped. Failures are non-fatal (returns []): the doorway is an enhancement,
 * never a hard dependency of answering.
 */
export async function linkTurnEntities(
  params: LinkTurnEntitiesParams,
): Promise<LinkedEntity[]> {
  const { userId, userTurn } = params;
  const cap = params.cap ?? TURN_ENTITY_CAP;
  const turn = userTurn?.trim();
  if (!turn) return [];

  let entities: LinkableEntity[];
  try {
    entities = params.entities ?? (await listLinkableEntities(userId));
  } catch (err) {
    log.warn("listLinkableEntities failed; no turn links", err as Error);
    return [];
  }
  if (entities.length === 0) return [];

  // 1. Lexical scan: surface (lowercased) → {index, entityIds}.
  const bySurface = new Map<string, SurfaceMatch>();
  for (const ent of entities) {
    const names = [ent.canonicalName, ...ent.aliases];
    for (const name of names) {
      const clean = name?.trim();
      if (!clean || clean.length < MIN_NAME_LEN) continue;
      const index = firstWordMatchIndex(turn, clean);
      if (index < 0) continue;
      const key = clean.toLowerCase();
      const existing = bySurface.get(key);
      if (existing) {
        if (!existing.entityIds.includes(ent.id)) existing.entityIds.push(ent.id);
        if (index < existing.index) existing.index = index;
      } else {
        bySurface.set(key, { surface: clean, index, entityIds: [ent.id] });
      }
    }
  }
  if (bySurface.size === 0) return [];

  const entityById = new Map(entities.map((e) => [e.id, e]));

  // Embed the turn at most once, and only if some surface is ambiguous.
  const needsEmbedding = Array.from(bySurface.values()).some(
    (m) => m.entityIds.length > 1,
  );
  let turnEmbedding: number[] | null = null;
  if (needsEmbedding) {
    try {
      const embed = params.embedTurn ?? (async (t: string) => (await embedText(t)).embedding);
      turnEmbedding = await embed(turn);
    } catch (err) {
      log.warn("turn embedding failed; skipping ambiguous surfaces", err as Error);
      turnEmbedding = null;
    }
  }

  // 2. Resolve each surface through the SHARED decision (thresholds not duped).
  const resolved: Array<{ entityId: string; index: number; surface: string; via: "exact" | "embedding" }> = [];
  for (const match of bySurface.values()) {
    if (match.entityIds.length === 1) {
      const candidates: LinkCandidate[] = [
        { id: match.entityIds[0]!, distance: null, nameMatch: true },
      ];
      const decision = decideEntityLink(candidates);
      if (decision.kind === "matched") {
        resolved.push({
          entityId: decision.entityId,
          index: match.index,
          surface: match.surface,
          via: decision.via,
        });
      }
      continue;
    }

    // Same-name ambiguity → embedding disambiguation (confident single only).
    if (!turnEmbedding) continue;
    let distances: Map<string, number>;
    try {
      distances = await entityEmbeddingDistances(userId, match.entityIds, turnEmbedding);
    } catch (err) {
      log.warn("entity distance lookup failed; skipping surface", err as Error);
      continue;
    }
    const candidates: LinkCandidate[] = match.entityIds.map((id) => ({
      id,
      distance: distances.has(id) ? distances.get(id)! : null,
      nameMatch: false,
    }));
    const decision = decideEntityLink(candidates);
    if (decision.kind === "matched") {
      resolved.push({
        entityId: decision.entityId,
        index: match.index,
        surface: match.surface,
        via: decision.via,
      });
    }
    // ambiguous / none → NO link (prefer silence over a wrong link).
  }

  // 3. De-dup by entity, order by appearance, cap.
  const seen = new Set<string>();
  const ordered = resolved
    .sort((a, b) => a.index - b.index)
    .filter((r) => {
      if (seen.has(r.entityId)) return false;
      seen.add(r.entityId);
      return true;
    })
    .slice(0, cap);

  return ordered.map((r) => {
    const ent = entityById.get(r.entityId)!;
    return {
      entityId: r.entityId,
      canonicalName: ent.canonicalName,
      type: ent.type,
      surface: r.surface,
      via: r.via,
    };
  });
}
