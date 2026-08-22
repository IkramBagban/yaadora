import { z } from "zod";
import { embedText } from "@repo/core";
import { hybridSearch, type TimeRange } from "@repo/db";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { badRequest, json, unauthorized, serverError } from "../http";

const log = createLogger("server:search");

/**
 * GET /memories/search?q= — hybrid retrieval for the web search box
 * (backend-gaps wave).
 *
 * Thin wrapper over the existing `hybridSearch()` in @repo/db: one embedding
 * of the raw query (vector + lexical channels; no entity seed and no LLM
 * query-rewriting — that is the Ask agent's job), fused results capped.
 * If the embedding provider is unavailable the vector channels are skipped
 * and lexical recall still answers.
 *
 * Bun's router prefers static segments over :params, so /memories/search wins
 * over /memories/:id.
 */

const SearchQuery = z.object({
  q: z.string().trim().min(1, "q is required").max(512),
  /** current-only facts (valid_to IS NULL); history searches include closed facts */
  view: z.enum(["current", "history"]).default("current"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function searchMemoriesRoute(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  const url = new URL(req.url);
  const parsed = SearchQuery.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    view: url.searchParams.get("view") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const { q, view, limit } = parsed.data;

  let embeddings: number[][] = [];
  try {
    const { embedding } = await embedText(q);
    embeddings = embedding.length ? [embedding] : [];
  } catch (err) {
    // Degraded mode: lexical channel only. Never fail the search on this.
    log.warn("query embedding failed; falling back to lexical", {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const result = await hybridSearch({
      userId,
      embeddings,
      queries: [q],
      entityIds: [], // no turn-time entity resolution on this thin endpoint
      timeRange: null as TimeRange | null,
      currentOnly: view === "current",
      perChannelLimit: limit,
      poolLimit: limit,
    });

    return json({
      query: q,
      memories: result.memories.slice(0, limit).map((c) => ({
        ...c.row,
        occurredAt: c.row.occurredAt?.toISOString() ?? null,
        createdAt: c.row.createdAt.toISOString(),
        score: c.score,
        channels: c.channels,
      })),
      facts: result.facts.slice(0, limit).map((c) => ({
        ...c.row,
        validFrom: c.row.validFrom?.toISOString() ?? null,
        validTo: c.row.validTo?.toISOString() ?? null,
        createdAt: c.row.createdAt.toISOString(),
        score: c.score,
        channels: c.channels,
      })),
    });
  } catch (err) {
    log.error("search failed", err as Error);
    return serverError();
  }
}
