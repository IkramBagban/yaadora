/**
 * Bearer-token auth (spec 03 §1.4).
 *
 * v0 is single-user: a static bootstrap token (AUTH_BOOTSTRAP_TOKEN) maps to the
 * one seeded user. The shape is deliberately multi-user-ready — swap
 * `authenticate` for a real token→user lookup later and every route keeps
 * working, because they all already scope by the returned `userId`.
 */

import { createLogger } from "@repo/logger";

const log = createLogger("server:auth");

const BOOTSTRAP_TOKEN = process.env.AUTH_BOOTSTRAP_TOKEN;

// The seeded single user's id, set once on boot (see index.ts).
let boundUserId: string | null = null;

export function bindUser(userId: string): void {
  boundUserId = userId;
}

/** Returns the authenticated user's id, or null if the token is missing/invalid. */
export function authenticate(req: Request): string | null {
  if (!BOOTSTRAP_TOKEN || !boundUserId) {
    log.debug("auth rejected: server not configured (token/user unbound)");
    return null;
  }
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    log.debug("auth rejected: missing or malformed bearer header");
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  if (token !== BOOTSTRAP_TOKEN) {
    log.debug("auth rejected: token mismatch");
    return null;
  }
  return boundUserId;
}

export function isAuthConfigured(): boolean {
  return Boolean(BOOTSTRAP_TOKEN);
}
