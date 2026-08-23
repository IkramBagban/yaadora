import { z } from "zod";
import { notFound } from "../../http";

/**
 * Shared admin-route helpers (issue #31): opaque keyset cursors + uuid path
 * params. Cursor format is "<created_at ISO>~<id>"; the web panel treats it
 * as an opaque string and echoes nextCursor back.
 */

const Uuid = z.string().uuid();

export interface KeysetCursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(createdAt: Date, id: string): string {
  return `${createdAt.toISOString()}~${id}`;
}

export function decodeCursor(raw: string | null): KeysetCursor | null {
  if (!raw) return null;
  const sep = raw.lastIndexOf("~");
  if (sep <= 0) return null;
  const tsPart = raw.slice(0, sep);
  const idPart = raw.slice(sep + 1);
  if (!Uuid.safeParse(idPart).success) return null;
  const ts = new Date(tsPart);
  if (Number.isNaN(ts.getTime())) return null;
  return { createdAt: ts, id: idPart };
}

/** Validate a uuid path param or return a Response to bail with. */
export function requireUuidParam(
  value: string,
  label = "Resource",
): { id: string } | { response: Response } {
  if (!Uuid.safeParse(value).success) {
    return { response: notFound(`${label} not found.`) };
  }
  return { id: value };
}

/** Clamp + floor pagination limits coming from query params. */
export function parseLimit(raw: string | null, fallback: number): number {
  // NB: Number("") is 0, not NaN — treat empty/absent as "use the default".
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(100, Math.floor(n));
}
