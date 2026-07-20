import { db, entities, eq, desc } from "@repo/db";
import { createLogger } from "@repo/logger";

const log = createLogger("transcription:bias");

/**
 * Vocabulary biasing for speech-to-text.
 *
 * Proper nouns are the failure mode that actually hurts a memory product: if
 * "Adeeba" is transcribed as "Adiba", the memory is saved with a name that will
 * never match on recall — and the user has no idea it happened. Feeding the
 * user's known entity names to Whisper as a prompt largely fixes this.
 *
 * Cached in-process per user: entity lists change slowly, and this sits on the
 * latency path of every voice capture.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
const TERM_LIMIT = 60;

interface CacheEntry {
  terms: string[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * The user's most-mentioned entity names, for Whisper's `prompt` parameter.
 * Never throws — biasing is an accuracy nicety, and a DB hiccup must not break
 * transcription.
 */
export async function getBiasTermsForUser(userId: string): Promise<string[]> {
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.terms;

  try {
    const rows = await db
      .select({
        canonicalName: entities.canonicalName,
        aliases: entities.aliases,
      })
      .from(entities)
      .where(eq(entities.userId, userId))
      .orderBy(desc(entities.mentionCount))
      .limit(TERM_LIMIT);

    const terms: string[] = [];
    for (const row of rows) {
      if (row.canonicalName) terms.push(row.canonicalName);
      // Aliases are how the user actually says the name out loud ("mom", "Abu").
      const aliases = row.aliases as unknown;
      if (Array.isArray(aliases)) {
        for (const alias of aliases) {
          if (typeof alias === "string") terms.push(alias);
        }
      }
    }

    cache.set(userId, { terms, expiresAt: Date.now() + CACHE_TTL_MS });
    return terms;
  } catch (err) {
    log.warn("bias term lookup failed (continuing unbiased)", err as any);
    return [];
  }
}

/** Drop a user's cached terms — call after ingestion creates new entities. */
export function invalidateBiasTerms(userId: string): void {
  cache.delete(userId);
}
