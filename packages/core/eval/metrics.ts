/**
 * Retrieval metrics — small, dependency-free, unit-testable.
 *
 * All functions operate on ORDERED lists of memory ids (citation order = the
 * app's confidence order) and a SET of expected ids. Keeping them pure makes the
 * runner easy to reason about and lets you sanity-check the math by hand.
 */

/**
 * recall@k — fraction of the expected memories that appear in the top-k results.
 * With one expected id this is simply hit/miss; with several it is partial.
 */
export function recallAtK(
  ranked: string[],
  expected: string[],
  k: number,
): number {
  if (expected.length === 0) return 1;
  const topK = new Set(ranked.slice(0, k));
  const found = expected.filter((id) => topK.has(id)).length;
  return found / expected.length;
}

/**
 * Reciprocal rank of the FIRST expected id (1-indexed). 0 if none present in
 * the top-k. Averaged across cases this is MRR.
 */
export function reciprocalRank(
  ranked: string[],
  expected: string[],
  k: number,
): number {
  const wanted = new Set(expected);
  const limit = Math.min(k, ranked.length);
  for (let i = 0; i < limit; i++) {
    if (wanted.has(ranked[i]!)) return 1 / (i + 1);
  }
  return 0;
}

/** Did any FORBIDDEN id (stale/decoy) get cited? A hit here is a correctness bug. */
export function hasForbidden(ranked: string[], forbid: string[]): boolean {
  if (forbid.length === 0) return false;
  const set = new Set(ranked);
  return forbid.some((id) => set.has(id));
}

/** Mean of a numeric list; 0 for an empty list. */
export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Round to 3 decimals for stable report output. */
export function r3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
