/**
 * Duplicate detection for reminder creation.
 *
 * The agent can be asked for the same reminder twice — across turns, or because
 * the user restates it ("remind me to call mom Sunday" … "actually remind me
 * about mom on Sunday"). Without a check, `set_reminder` inserts unconditionally
 * and the user ends up with two rows firing at the same time.
 *
 * Deliberately conservative: a false positive silently swallows a reminder the
 * user asked for, which is far worse than a duplicate they can delete. So the
 * bar is "clearly the same thing at essentially the same time", not "similar".
 */

/** Reminders due within this many hours of each other can be duplicates. */
export const DEDUPE_WINDOW_HOURS = 12;

/** Word-overlap ratio above which two reminder texts count as the same. */
export const DEDUPE_SIMILARITY_THRESHOLD = 0.7;

/**
 * Words carrying no distinguishing signal in a short imperative. Dropping them
 * stops "call the bank" and "call the doctor" scoring high on "call"+"the".
 */
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "about",
  "for",
  "from",
  "in",
  "me",
  "my",
  "of",
  "on",
  "or",
  "remind",
  "reminder",
  "set",
  "the",
  "to",
  "with",
]);

/** Lowercase, strip punctuation, drop stopwords. */
export function tokenizeReminderText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
}

/**
 * Jaccard similarity over content words: |intersection| / |union|.
 *
 * Symmetric, so "call mom" vs "call mom tomorrow" scores 0.5 rather than 1.0 in
 * one direction — which is the conservative behaviour we want. Two texts that
 * reduce to nothing but stopwords score 0 (never duplicates).
 */
export function reminderTextSimilarity(a: string, b: string): number {
  const setA = new Set(tokenizeReminderText(a));
  const setB = new Set(tokenizeReminderText(b));
  if (setA.size === 0 || setB.size === 0) return 0;

  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared++;

  const union = setA.size + setB.size - shared;
  return union === 0 ? 0 : shared / union;
}

export interface DuplicateCandidate {
  id: string;
  text: string;
  dueAt: Date;
}

export interface DuplicateMatch {
  id: string;
  text: string;
  dueAt: Date;
  similarity: number;
  hoursApart: number;
}

/**
 * The best duplicate for `text`/`dueAt` among `candidates`, or null.
 *
 * Candidates are expected to already be filtered to pending reminders in a
 * nearby time window (see `findNearbyPendingReminders`); this applies the text
 * test and picks the strongest match.
 */
export function findDuplicateReminder(
  text: string,
  dueAt: Date,
  candidates: DuplicateCandidate[],
  opts: { threshold?: number; windowHours?: number } = {},
): DuplicateMatch | null {
  const threshold = opts.threshold ?? DEDUPE_SIMILARITY_THRESHOLD;
  const windowHours = opts.windowHours ?? DEDUPE_WINDOW_HOURS;

  let best: DuplicateMatch | null = null;

  for (const candidate of candidates) {
    const hoursApart =
      Math.abs(candidate.dueAt.getTime() - dueAt.getTime()) / (60 * 60 * 1000);
    if (hoursApart > windowHours) continue;

    const similarity = reminderTextSimilarity(text, candidate.text);
    if (similarity < threshold) continue;

    if (!best || similarity > best.similarity) {
      best = {
        id: candidate.id,
        text: candidate.text,
        dueAt: candidate.dueAt,
        similarity,
        hoursApart,
      };
    }
  }

  return best;
}
