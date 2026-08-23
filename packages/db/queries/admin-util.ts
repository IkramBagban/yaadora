/**
 * Shared row-coercion helpers for the admin query modules (issue #31).
 * postgres.js returns loosely-typed rows through db.execute — every module
 * narrows with the same two primitives (mirrors stats.ts).
 */

export const asRows = (rows: unknown): Array<Record<string, unknown>> =>
  rows as unknown as Array<Record<string, unknown>>;

/** postgres.js may hand back Date objects OR strings depending on OID — normalize. */
export const asDate = (v: unknown): Date =>
  v instanceof Date ? v : new Date(String(v));

/** ISO timestamp for wire responses. */
export const iso = (v: unknown): string => asDate(v).toISOString();
