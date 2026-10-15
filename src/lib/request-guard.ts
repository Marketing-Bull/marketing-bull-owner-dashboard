const DEFAULT_ALLOWED_HOSTS = [
  "localhost",
  "127.0.0.1",
  "100.119.59.63:3018",
  "amb-ubuntu-01.tail7a2140.ts.net:3018"
];

export type RequestGuardDecision =
  | { allowed: true }
  | { allowed: false; status: 403 | 421; message: string };

function hostMatches(requestHost: string | null, allowedHosts: string): boolean {
  if (!requestHost) return false;
  let requestUrl: URL;
  try {
    requestUrl = new URL(`http://${requestHost}`);
  } catch {
    return false;
  }

  return [...DEFAULT_ALLOWED_HOSTS, ...allowedHosts.split(",").map((host) => host.trim()).filter(Boolean)]
    .some((host) => {
      try {
        const allowedUrl = new URL(`http://${host}`);
        return host.includes(":")
          ? requestUrl.host === allowedUrl.host
          : requestUrl.hostname === allowedUrl.hostname;
      } catch {
        return false;
      }
    });
}

function sameOrigin(origin: string, requestHost: string | null): boolean {
  if (!requestHost) return false;
  try {
    const originUrl = new URL(origin);
    if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") return false;
    return new URL(`${originUrl.protocol}//${requestHost}`).origin === originUrl.origin;
  } catch {
    return false;
  }
}

export function guardRequest(
  method: string,
  pathname: string,
  host: string | null,
  headers: Headers,
  configuredHosts = process.env.OWNER_DASHBOARD_ALLOWED_HOSTS ?? ""
): RequestGuardDecision {
  if (!hostMatches(host, configuredHosts)) {
    return { allowed: false, status: 421, message: "This host is not allowed." };
  }

  if (!pathname.startsWith("/api/") || !["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) {
    return { allowed: true };
  }

  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return { allowed: false, status: 403, message: "Cross-origin writes are not allowed." };
  }

  const origin = headers.get("origin");
  if (origin && !sameOrigin(origin, host)) {
    return { allowed: false, status: 403, message: "Cross-origin writes are not allowed." };
  }

  return { allowed: true };
}
