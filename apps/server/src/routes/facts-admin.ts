import { z } from "zod";
import { listFactsAdmin, patchFactAdmin } from "@repo/db";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { badRequest, json, notFound, unauthorized, serverError } from "../http";

const log = createLogger("server:facts-admin");

/**
 * Facts admin routes (backend-gaps wave).
 *
 * GET   /facts?subject=&type=&view=current|history&conflicted=true&limit&cursor
 * PATCH /facts/:id  { hidden?: boolean, conflictNote?: string | null }
 *
 * `subject` accepts an entity uuid (subject OR object match) or a name
 * fragment (ILIKE on canonical names). Hidden facts are still listed here —
 * the flag is review metadata, not a delete.
 */

function serialize(row: Awaited<ReturnType<typeof listFactsAdmin>>[number]) {
  return {
    ...row,
    validFrom: row.validFrom?.toISOString() ?? null,
    validTo: row.validTo?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ListQuery = z.object({
  subject: z.string().trim().min(1).max(200).optional(),
  type: z.string().trim().min(1).max(100).optional(),
  view: z.enum(["current", "history"]).default("current"),
  conflicted: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});

/** GET /facts — filterable, keyset-paginated fact listing. */
export async function listFactsRoute(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  const url = new URL(req.url);
  const parsed = ListQuery.safeParse({
    subject: url.searchParams.get("subject") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    view: url.searchParams.get("view") ?? undefined,
    conflicted: url.searchParams.get("conflicted") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const { subject, type, view, conflicted, limit, cursor } = parsed.data;

  let cursorCreatedAt: Date | null = null;
  let cursorId: string | null = null;
  if (cursor) {
    const sep = cursor.lastIndexOf("|");
    const tsPart = sep > 0 ? cursor.slice(0, sep) : "";
    const idPart = sep > 0 ? cursor.slice(sep + 1) : "";
    const ts = new Date(tsPart);
    if (!tsPart || Number.isNaN(ts.getTime()) || !UUID_RE.test(idPart)) {
      return badRequest("cursor must be '<ISO timestamp>|<fact uuid>'.");
    }
    cursorCreatedAt = ts;
    cursorId = idPart;
  }

  try {
    const items = await listFactsAdmin({
      userId,
      entityId: subject && UUID_RE.test(subject) ? subject : null,
      subjectName:
        subject && !UUID_RE.test(subject)
          ? subject.replace(/[%_]/g, (c) => `\\${c}`)
          : null,
      factType: type ?? null,
      view,
      conflictedOnly: conflicted,
      limit,
      cursorCreatedAt,
      cursorId,
    });

    const last = items.at(-1);
    const nextCursor =
      items.length === limit && last
        ? `${last.createdAt.toISOString()}|${last.id}`
        : null;

    return json({ items: items.map(serialize), nextCursor });
  } catch (err) {
    log.error("listFacts failed", err as Error);
    return serverError();
  }
}

const PatchBody = z
  .object({
    hidden: z.boolean().nullable().optional(),
    conflictNote: z.string().max(2000).nullable().optional(),
  })
  .refine((d) => d.hidden !== undefined || d.conflictNote !== undefined, {
    message: "At least one of hidden or conflictNote is required.",
  });

/** PATCH /facts/:id — hide/unhide a fact and/or set its conflict note. */
export async function patchFactRoute(
  req: Request,
  factId: string,
): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  if (!factId || !z.string().uuid().safeParse(factId).success) {
    return badRequest("fact id must be a uuid.");
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest("Body must be valid JSON.");
  }
  const parsed = PatchBody.safeParse(raw);
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }

  try {
    const updated = await patchFactAdmin(userId, factId, parsed.data);
    if (!updated) return notFound("Fact not found.");
    log.info("fact patched", { userId, factId });
    return json(serialize(updated));
  } catch (err) {
    log.error("patchFact failed", err as Error);
    return serverError();
  }
}
