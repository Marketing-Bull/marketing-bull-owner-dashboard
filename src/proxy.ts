import { NextResponse, type NextRequest } from "next/server";
import {
  AUTH_COOKIE_NAME,
  authFailureMessage,
  authorizeRequest,
  isPublicPath,
  readBearerToken
} from "@/lib/auth";

/**
 * Gates the dashboard and every private API route.
 *
 * Three states, decided in `@/lib/auth`: token set -> credentials required;
 * token unset -> locked (setup needed); token unset with the explicit
 * `OWNER_DASHBOARD_ALLOW_UNPROTECTED` opt-out -> open.
 *
 * Page requests are redirected to `/login`, which doubles as the setup screen
 * when no token exists. API requests get JSON — 401 for bad credentials, 503
 * for the locked state, since "nothing is configured to sign in with" is a
 * server condition, not a caller mistake.
 *
 * Uses Next 16's `proxy` file convention; `middleware.ts` is deprecated.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const decision = authorizeRequest({
    cookieToken: request.cookies.get(AUTH_COOKIE_NAME)?.value,
    bearerToken: readBearerToken(request.headers.get("authorization"))
  });

  if (decision.allowed) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: authFailureMessage(decision.reason) },
      {
        status: decision.reason === "not-configured" ? 503 : 401,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except Next's own static output. API routes are deliberately
  // included -- /api/state is the endpoint that most needs the gate.
  matcher: ["/((?!_next/static|_next/image).*)"]
};
