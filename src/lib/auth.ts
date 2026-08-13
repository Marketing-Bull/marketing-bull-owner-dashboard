/**
 * Shared auth helpers for the owner dashboard.
 *
 * The dashboard holds revenue figures, goals, and client phone numbers, and
 * `/api/state` both reads and writes them. Everything here is edge-safe so the
 * same helpers can run inside `proxy.ts` and inside route handlers.
 *
 * Access model:
 * - `OWNER_DASHBOARD_AUTH_TOKEN` set   -> every request needs the token.
 * - unset                              -> the dashboard is LOCKED: pages show
 *   setup instructions, APIs answer 503, and no data is served or written.
 * - unset + `OWNER_DASHBOARD_ALLOW_UNPROTECTED=1` -> open to anyone who can
 *   reach it, with the "Unprotected" chip shown in the header.
 *
 * The default used to be open-when-unset so the app ran with zero
 * configuration. That was a defensible trade for MRR and a phone list; it is
 * not one for the client contacts, rates, and financial entries this store is
 * about to hold (consolidation phase 1). Running open is still possible on a
 * private machine — but only by saying so explicitly.
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

export type AuthFailure = "invalid-credentials" | "not-configured";

export type AuthDecision = { allowed: true } | { allowed: false; reason: AuthFailure };

export function getConfiguredToken(): string | null {
  return process.env.OWNER_DASHBOARD_AUTH_TOKEN?.trim() || null;
}

/** False means the dashboard is currently serving everyone, unauthenticated. */
export function isAuthConfigured(): boolean {
  return getConfiguredToken() !== null;
}

/**
 * The explicit "yes, run open" switch for tokenless setups (a laptop, local
 * dev). Accepts 1/true/yes so a shell-quoted value doesn't silently fail into
 * the locked state.
 */
export function allowUnprotected(): boolean {
  const value = process.env.OWNER_DASHBOARD_ALLOW_UNPROTECTED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
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

  // No token configured: locked unless running open was explicitly chosen.
  // There is nothing to authenticate against, so this is a setup problem
  // (503-shaped), not a credentials problem (401-shaped).
  if (!expected) {
    return allowUnprotected() ? { allowed: true } : { allowed: false, reason: "not-configured" };
  }

  if (tokensMatch(input.cookieToken, expected) || tokensMatch(input.bearerToken, expected)) {
    return { allowed: true };
  }

  return { allowed: false, reason: "invalid-credentials" };
}

export function authFailureMessage(reason: AuthFailure = "invalid-credentials"): string {
  if (reason === "not-configured") {
    return "This dashboard is locked: no OWNER_DASHBOARD_AUTH_TOKEN is set. Set one and restart, or set OWNER_DASHBOARD_ALLOW_UNPROTECTED=1 to deliberately run open on a private machine.";
  }
  return "Authentication required.";
}

export function readBearerToken(authorizationHeader: string | null): string | undefined {
  if (!authorizationHeader) return undefined;
  const [scheme, ...rest] = authorizationHeader.split(" ");
  if (scheme.toLowerCase() !== "bearer") return undefined;
  return rest.join(" ").trim() || undefined;
}
