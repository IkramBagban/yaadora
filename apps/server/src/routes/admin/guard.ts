import { db, eq, users } from "@repo/db";
import { authenticate } from "../../auth";
import { forbidden, unauthorized } from "../../http";

/**
 * Admin guard (issue #31). Every /admin route resolves the bearer token and
 * requires users.role === 'admin' — anything else gets 403 {forbidden}.
 * Unauthenticated requests keep the standard 401 so clients can distinguish
 * "sign in" from "not an admin".
 */

export type AdminAuth =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

export async function requireAdmin(req: Request): Promise<AdminAuth> {
  const userId = await authenticate(req);
  if (!userId) return { ok: false, response: unauthorized() };

  const [row] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row || row.role !== "admin") return { ok: false, response: forbidden() };
  return { ok: true, userId };
}
