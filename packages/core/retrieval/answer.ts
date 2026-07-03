import { streamText } from "ai";
import type { EntityProfile, RetrievedMemory } from "@repo/db";
import { reasoningModel } from "../ai/models";
import type { RerankedCandidate } from "./rerank";

/**
 * Grounded answer generation (spec 02 §3.4).
 *
 * The answer must map every claim to a retrieved source. Citations reference
 * source memories by a stable tag ([M1], [M2], ...). The GROUNDEDNESS GUARD in
 * ./index.ts refuses BEFORE generation when nothing relevant is retrieved — a
 * memory app must never invent a memory (CONTEXT.md core principle).
 */

export interface Citation {
  memoryId: string;
  snippet: string;
  occurredAt: string | null;
}

export interface AssembledContext {
  /** the prompt context block handed to the reasoning model */
  contextText: string;
  /** structured citations returned to the client, in relevance order */
  citations: Citation[];
}

/** The honest refusal when retrieval finds nothing to stand on (spec 02 §3.4). */
export const REFUSAL_TEXT = "I don't have a memory about that.";

const SNIPPET_MAX = 200;

function snippet(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > SNIPPET_MAX ? `${clean.slice(0, SNIPPET_MAX)}…` : clean;
}

/**
 * Assemble the grounded-answer context: reranked facts + their source-memory
 * snippets + entity profiles + timestamps, with stable [M#] citation tags.
 */
export function assembleContext(params: {
  reranked: RerankedCandidate[];
  memoriesById: Map<string, RetrievedMemory>;
  entityProfiles: EntityProfile[];
  maxCitations?: number;
}): AssembledContext {
  const { reranked, memoriesById, entityProfiles, maxCitations = 8 } = params;

  // Assign a stable [M#] tag per distinct source memory, in relevance order.
  const memoryTag = new Map<string, string>();
  const citations: Citation[] = [];
  for (const cand of reranked) {
    const mid = cand.memoryId;
    if (memoryTag.has(mid)) continue;
    const mem = memoriesById.get(mid);
    const text = mem?.rawText ?? cand.text;
    const tag = `M${memoryTag.size + 1}`;
    memoryTag.set(mid, tag);
    if (citations.length < maxCitations) {
      citations.push({
        memoryId: mid,
        snippet: snippet(text),
        occurredAt:
          (mem?.occurredAt ?? mem?.createdAt ?? null)?.toISOString() ??
          cand.timestamp,
      });
    }
  }

  const factLines: string[] = [];
  const memoryLines: string[] = [];
  for (const cand of reranked) {
    const tag = memoryTag.get(cand.memoryId) ?? "M?";
    const ts = cand.timestamp ? ` (${cand.timestamp.slice(0, 10)})` : "";
    if (cand.kind === "fact") {
      factLines.push(`- [${tag}]${ts} ${cand.text}`);
    } else {
      memoryLines.push(`- [${tag}]${ts} "${snippet(cand.text)}"`);
    }
  }

  const profileLines = entityProfiles
    .filter((e) => e.profile)
    .map((e) => `- ${e.canonicalName} (${e.type}): ${e.profile}`);

  const sections: string[] = [];
  if (factLines.length) sections.push(`FACTS:\n${factLines.join("\n")}`);
  if (memoryLines.length) sections.push(`MEMORIES:\n${memoryLines.join("\n")}`);
  if (profileLines.length)
    sections.push(`ENTITY PROFILES:\n${profileLines.join("\n")}`);

  return { contextText: sections.join("\n\n"), citations };
}

const SYSTEM_PROMPT = `You answer questions using ONLY the user's own retrieved memories.
Absolute rules:
- Ground EVERY claim in the provided context. Never state anything not supported by it.
- Cite the source memory inline using its tag, e.g. "(memory M1)". Cite each claim.
- If the context does not contain the answer, reply EXACTLY: "${REFUSAL_TEXT}"
- Never invent memories, dates, people, or details. Do not use outside knowledge.
- Be concise and direct. Speak to the user in the second person.`;

/**
 * Stream a grounded answer over the assembled context. Returns the streaming
 * result; the caller consumes `.textStream`. The refusal branch is handled by
 * the orchestrator BEFORE this is ever called.
 */
export function streamGroundedAnswer(params: {
  question: string;
  context: string;
}): { textStream: AsyncIterable<string> } {
  const result = streamText({
    model: reasoningModel,
    system: SYSTEM_PROMPT,
    prompt: `Retrieved context:
${params.context}

Question: ${params.question}

Answer using only the context above, citing memory tags inline.`,
  });
  return { textStream: result.textStream };
}
