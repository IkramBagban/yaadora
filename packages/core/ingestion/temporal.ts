/**
 * Temporal helpers shared across the ingestion stages (spec 02 §2.2).
 *
 * Extraction hands back dates as model-authored ISO strings, so every consumer
 * needs the same tolerant parse: a missing field and an unparseable field both
 * mean "no date", never a crash and never an Invalid Date leaking into a column.
 */

/** Parse an extraction-authored ISO string, or null when absent/unparseable. */
export function parseDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
