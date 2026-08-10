/**
 * Shared auth helpers for the owner dashboard.
 *
 * The dashboard holds revenue figures, goals, and client phone numbers, and
 * `/api/state` both reads and writes them. Everything here is edge-safe so the
 * same helpers can run inside `middleware.ts` and inside route handlers.
 *
 * Access model:
 * - `OWNER_DASHBOARD_AUTH_TOKEN` set   -> every request needs the token.
 * - `OWNER_DASHBOARD_AUTH_TOKEN` unset -> only loopback requests are served, so
 *   `npm run dev` keeps working with no config but the app fails closed as soon
 *   as it is reachable from another device.
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

export type AuthFailure = "local-only" | "invalid-credentials";

export type AuthDecision = { allowed: true } | { allowed: false; reason: AuthFailure };

export function getConfiguredToken(): string | null {
  return process.env.OWNER_DASHBOARD_AUTH_TOKEN?.trim() || null;
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

/**
 * Host-header check backing the token-free local mode.
 *
 * A hostile client can forge `Host`, so this is not a defence against a
 * determined attacker — it exists to stop the dashboard from serving private
 * data over a LAN, tunnel, or deployment where no token was configured. Set
 * `OWNER_DASHBOARD_AUTH_TOKEN` for anything beyond your own machine.
 */
export function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  const hostname = (host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0])
    .toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
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
  host: string | null;
  cookieToken: string | undefined;
  bearerToken: string | undefined;
}): AuthDecision {
  const expected = getConfiguredToken();

  if (!expected) {
    return isLoopbackHost(input.host) ? { allowed: true } : { allowed: false, reason: "local-only" };
  }

  if (tokensMatch(input.cookieToken, expected) || tokensMatch(input.bearerToken, expected)) {
    return { allowed: true };
  }

  return { allowed: false, reason: "invalid-credentials" };
}

export function authFailureMessage(reason: AuthFailure): string {
  return reason === "local-only"
    ? "This dashboard only serves localhost until OWNER_DASHBOARD_AUTH_TOKEN is set. Set it to reach the dashboard from another device."
    : "Authentication required.";
}

export function readBearerToken(authorizationHeader: string | null): string | undefined {
  if (!authorizationHeader) return undefined;
  const [scheme, ...rest] = authorizationHeader.split(" ");
  if (scheme.toLowerCase() !== "bearer") return undefined;
  return rest.join(" ").trim() || undefined;
}
