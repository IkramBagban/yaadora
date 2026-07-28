import { embedTexts } from "../ai/models";
import type { Extraction } from "./extraction";

/**
 * Step 4 of the ingestion pipeline — multi-representation embeddings (spec 02
 * §2.6). One memory produces vectors for several different things, and they all
 * go out in a SINGLE embedMany call; this module owns the packing and unpacking
 * of that batch so no caller ever handles an offset.
 */

/**
 * Every vector step 4 produces, addressed by name instead of by offset.
 * `facts`, `mentions` and `loops` are positionally aligned with
 * `extraction.facts`, `extraction.entities` and `extraction.openLoops`.
 */
export interface ExtractionEmbeddings {
  /** The memory's own embedding; undefined only if the embedder returned nothing. */
  raw: number[] | undefined;
  facts: number[][];
  mentions: number[][];
  /** Empty when the extraction carried no standing rule. */
  rule: number[];
  loops: number[][];
  /** Empty when the extraction closed no loop. */
  resolution: number[];
}

/**
 * Embed everything one memory derives, in ONE call:
 * [ raw memory text, ...each fact text, ...each mention name, ...derived text ].
 *
 * The optional derived fields (rule trigger, loop titles, resolution text) share
 * a single tail. A blank field is skipped rather than embedded, so each one
 * records the index it actually landed on — that is what stops an absent rule
 * from shifting every later loop's vector. All of this offset bookkeeping stays
 * private to this function; callers only ever see the named fields above.
 */
export async function embedExtraction(
  rawText: string,
  extraction: Extraction,
): Promise<ExtractionEmbeddings> {
  const factTexts = extraction.facts.map((f) => f.factText);
  const mentionNames = extraction.entities.map((e) => e.canonicalGuess);

  const derivedTexts: string[] = [];
  const addDerivedText = (text: string | null): number | null => { 
    const normalized = text?.trim();
    if (!normalized) return null;
    derivedTexts.push(normalized);
    return derivedTexts.length - 1;
  };
  const ruleIndex = addDerivedText(extraction.standingRule?.triggerText ?? null);
  const loopIndexes = extraction.openLoops.map((loop) => addDerivedText(loop.title));
  const resolutionIndex = addDerivedText(extraction.resolvesLoop);

  const { embeddings } = await embedTexts([
    rawText,
    ...factTexts,
    ...mentionNames,
    ...derivedTexts,
  ]);

  const factsAt = 1;
  const mentionsAt = factsAt + factTexts.length;
  const derivedAt = mentionsAt + mentionNames.length;
  const derived = embeddings.slice(derivedAt);
  const derivedAtIndex = (index: number | null): number[] =>
    index === null ? [] : (derived[index] ?? []);

  return {
    raw: embeddings[0],
    facts: embeddings.slice(factsAt, mentionsAt),
    mentions: embeddings.slice(mentionsAt, derivedAt),
    rule: derivedAtIndex(ruleIndex),
    loops: loopIndexes.map(derivedAtIndex),
    resolution: derivedAtIndex(resolutionIndex),
  };
}
