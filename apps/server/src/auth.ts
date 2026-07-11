/**
 * Auth: Clerk session JWT (primary) + optional bootstrap bearer (dev/eval only).
 *
 * Product path: mobile sends `Authorization: Bearer <Clerk session JWT>`.
 * We verify with `@clerk/backend`, map `sub` → local `users.id`.
 *
 * Bootstrap path: only when AUTH_ALLOW_BOOTSTRAP=true (seed/eval scripts).
 * Never enable on a public VM.
 */

import { createClerkClient, verifyToken } from "@clerk/backend";
import { createLogger } from "@repo/logger";
import { resolveLocalUserId } from "./users";

const log = createLogger("server:auth");

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const CLERK_JWT_KEY = process.env.CLERK_JWT_KEY;
const BOOTSTRAP_TOKEN = process.env.AUTH_BOOTSTRAP_TOKEN;
const ALLOW_BOOTSTRAP = process.env.AUTH_ALLOW_BOOTSTRAP === "true";

/** Local users.id for the optional bootstrap identity (set at boot if allowed). */
let bootstrapUserId: string | null = null;

const clerk =
  CLERK_SECRET_KEY != null && CLERK_SECRET_KEY.length > 0
    ? createClerkClient({ secretKey: CLERK_SECRET_KEY })
    : null;

export function bindBootstrapUser(userId: string): void {
  bootstrapUserId = userId;
}

export function getBootstrapUserId(): string | null {
  return bootstrapUserId;
}

export function isAuthConfigured(): boolean {
  return Boolean(CLERK_SECRET_KEY) || (ALLOW_BOOTSTRAP && Boolean(BOOTSTRAP_TOKEN));
}

export function isClerkConfigured(): boolean {
  return Boolean(CLERK_SECRET_KEY);
}

export function isBootstrapAllowed(): boolean {
  return ALLOW_BOOTSTRAP && Boolean(BOOTSTRAP_TOKEN);
}

function tokenSummary(token: string): string {
  return `len=${token.length} head=${token.slice(0, 12)}…`;
}

function requestPath(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return "?";
  }
}

async function emailForClerkUser(clerkUserId: string): Promise<string | null> {
  if (!clerk) return null;
  try {
    log.debug("fetching Clerk user email", { clerkUserId });
    const user = await clerk.users.getUser(clerkUserId);
    const primary = user.emailAddresses.find(
      (e) => e.id === user.primaryEmailAddressId,
    );
    const email =
      primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
    log.debug("Clerk user email resolved", {
      clerkUserId,
      hasEmail: Boolean(email),
      emailCount: user.emailAddresses.length,
    });
    return email;
  } catch (err) {
    log.warn("failed to fetch Clerk user email", {
      clerkUserId,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Returns the authenticated local user's id, or null if the token is
 * missing/invalid.
 */
export async function authenticate(req: Request): Promise<string | null> {
  const path = requestPath(req);
  const method = req.method;
  const started = Date.now();

  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    log.debug("auth rejected: missing or malformed bearer header", {
      method,
      path,
      hasAuthorization: Boolean(header),
      headerPrefix: header ? header.slice(0, 20) : null,
    });
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    log.debug("auth rejected: empty token", { method, path });
    return null;
  }

  // --- Dev/eval bootstrap (never production) ---
  if (ALLOW_BOOTSTRAP && BOOTSTRAP_TOKEN && token === BOOTSTRAP_TOKEN) {
    if (!bootstrapUserId) {
      log.warn("auth rejected: bootstrap token matched but user unbound", {
        method,
        path,
      });
      return null;
    }
    log.debug("auth ok: bootstrap", {
      method,
      path,
      userId: bootstrapUserId,
      ms: Date.now() - started,
    });
    return bootstrapUserId;
  }

  if (!CLERK_SECRET_KEY || !clerk) {
    log.warn("auth rejected: Clerk not configured", {
      method,
      path,
      hasSecretKey: Boolean(CLERK_SECRET_KEY),
      token: tokenSummary(token),
    });
    return null;
  }

  try {
    log.debug("verifying Clerk JWT", {
      method,
      path,
      token: tokenSummary(token),
      networkless: Boolean(CLERK_JWT_KEY),
    });

    const payload = await verifyToken(token, {
      secretKey: CLERK_SECRET_KEY,
      ...(CLERK_JWT_KEY ? { jwtKey: CLERK_JWT_KEY } : {}),
    });

    const clerkUserId = payload.sub;
    if (!clerkUserId) {
      log.warn("auth rejected: token missing sub", {
        method,
        path,
        claims: Object.keys(payload as object),
      });
      return null;
    }

    // Session JWTs typically lack email; fall back to Clerk Backend API.
    let email: string | null = null;
    let emailSource: "jwt_email" | "jwt_primary" | "clerk_api" | null = null;
    const claims = payload as Record<string, unknown>;
    if (typeof claims.email === "string" && claims.email.length > 0) {
      email = claims.email;
      emailSource = "jwt_email";
    } else if (
      typeof claims.primary_email_address === "string" &&
      claims.primary_email_address.length > 0
    ) {
      email = claims.primary_email_address;
      emailSource = "jwt_primary";
    } else {
      email = await emailForClerkUser(clerkUserId);
      emailSource = email ? "clerk_api" : null;
    }

    if (!email) {
      log.warn("auth rejected: no email for Clerk user", {
        method,
        path,
        clerkUserId,
      });
      return null;
    }

    const tzHeader = req.headers.get("x-timezone");
    const timezoneHint =
      tzHeader && tzHeader.trim().length > 0 ? tzHeader.trim() : undefined;

    const userId = await resolveLocalUserId(clerkUserId, email, timezoneHint);
    log.info("auth ok: clerk", {
      method,
      path,
      clerkUserId,
      userId,
      emailSource,
      timezoneHint: timezoneHint ?? null,
      ms: Date.now() - started,
    });
    return userId;
  } catch (err) {
    log.warn("auth rejected: token verification failed", {
      method,
      path,
      token: tokenSummary(token),
      message: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : typeof err,
      ms: Date.now() - started,
    });
    return null;
  }
}
