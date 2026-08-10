/**
 * Shared auth helpers for the owner dashboard.
 *
 * The dashboard holds revenue figures, goals, and client phone numbers, and
 * `/api/state` both reads and writes them. Everything here is edge-safe so the
 * same helpers can run inside `proxy.ts` and inside route handlers.
 *
 * Access model:
 * - `OWNER_DASHBOARD_AUTH_TOKEN` set   -> every request needs the token.
 * - `OWNER_DASHBOARD_AUTH_TOKEN` unset -> the dashboard is open to anyone who
 *   can reach it.
 *
 * The unset case is deliberately open so the app runs with no configuration.
 * That means an unconfigured deployment serves revenue figures, goals, and
 * client phone numbers to anything that can route to it — setting the token is
 * what makes this safe to expose, and the UI flags the unprotected state so it
 * cannot be forgotten silently.
 */

export const AUTH_COOKIE_NAME = "owner_dashboard_auth";

/** Paths that must stay reachable without a session, or login can never happen. */
const PUBLIC_PATHS = new Set([
  "/login",
  "/api/login",
  "/manifest.webmanifest",
  "/sw.js",
  "/icon",
  "/apple-icon",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/favicon.ico"
]);

export type AuthFailure = "invalid-credentials";

export type AuthDecision = { allowed: true } | { allowed: false; reason: AuthFailure };

export function getConfiguredToken(): string | null {
  return process.env.OWNER_DASHBOARD_AUTH_TOKEN?.trim() || null;
}

/** False means the dashboard is currently serving everyone, unauthenticated. */
export function isAuthConfigured(): boolean {
  return getConfiguredToken() !== null;
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

/** Length-independent comparison so token checks don't leak the token via timing. */
export function tokensMatch(candidate: string | undefined | null, expected: string): boolean {
  if (!candidate) return false;

  let diff = candidate.length ^ expected.length;
  const length = Math.max(candidate.length, expected.length);
  for (let index = 0; index < length; index += 1) {
    // charCodeAt returns NaN past the end; `|| 0` keeps the XOR well-defined.
    diff |= (candidate.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }

  return diff === 0;
}

/**
 * Decides whether a request may proceed. `bearer` covers scripted access,
 * `cookie` covers the browser session issued by `/api/login`.
 */
export function authorizeRequest(input: {
  cookieToken: string | undefined;
  bearerToken: string | undefined;
}): AuthDecision {
  const expected = getConfiguredToken();

  // No token configured: the dashboard is open. Nothing to check against, and
  // refusing here would lock out a deployment that has no way to sign in.
  if (!expected) return { allowed: true };

  if (tokensMatch(input.cookieToken, expected) || tokensMatch(input.bearerToken, expected)) {
    return { allowed: true };
  }

  return { allowed: false, reason: "invalid-credentials" };
}

export function authFailureMessage(): string {
  return "Authentication required.";
}

export function readBearerToken(authorizationHeader: string | null): string | undefined {
  if (!authorizationHeader) return undefined;
  const [scheme, ...rest] = authorizationHeader.split(" ");
  if (scheme.toLowerCase() !== "bearer") return undefined;
  return rest.join(" ").trim() || undefined;
}
