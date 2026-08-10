import { NextResponse, type NextRequest } from "next/server";
import {
  AUTH_COOKIE_NAME,
  authFailureMessage,
  authorizeRequest,
  isPublicPath,
  readBearerToken
} from "@/lib/auth";

/**
 * Gates the dashboard and every private API route, but only when
 * `OWNER_DASHBOARD_AUTH_TOKEN` is set. With no token configured every request
 * passes through, so the app runs with zero configuration.
 *
 * Page requests are redirected to `/login`; API requests get a 401 so the
 * client surfaces a real error instead of rendering a login page as JSON.
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
      { error: authFailureMessage() },
      { status: 401, headers: { "Cache-Control": "no-store" } }
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
