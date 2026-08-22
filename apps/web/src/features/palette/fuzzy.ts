/**
 * Tiny fuzzy matcher for the command palette: case-insensitive subsequence
 * match over the target with a contiguity bonus, so "tm" matches "Timeline"
 * and "usr" matches "user settings". Returns a score (higher = better) or
 * `null` when the query is not a subsequence of the target.
 *
 * Deliberately dependency-free — no fuzzy lib in package.json and shared
 * deps are frozen.
 */
export function fuzzyScore(query: string, target: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  let score = 0;
  let ti = 0;
  let streak = 0;

  for (let qi = 0; qi < q.length; qi += 1) {
    const ch = q[qi] as string;
    // Skip separators in the query so "open graph" still matches "OpenGraph".
    if (ch === ' ') {
      streak = 0;
      continue;
    }
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    // Consecutive characters are much more likely to be intended.
    streak = found === ti ? streak + 1 : 0;
    score += 1 + streak * 2 + (found === 0 ? 4 : 0);
    ti = found + 1;
  }
  // Prefer tighter targets: "graph" ranks above "knowledge graph overview".
  return score - t.length * 0.05;
}

/** Best score across label + keywords; `null` when nothing matches. */
export function fuzzyMatch(query: string, ...fields: string[]): number | null {
  let best: number | null = null;
  for (const field of fields) {
    const score = fuzzyScore(query, field);
    if (score !== null && (best === null || score > best)) best = score;
  }
  return best;
}
