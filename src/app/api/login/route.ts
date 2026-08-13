import { NextResponse } from "next/server";
import { allowUnprotected, AUTH_COOKIE_NAME, getConfiguredToken, tokensMatch } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Cookie lifetime. Long enough that the installed PWA is not a daily login chore. */
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Public probe for the login page: is there anything to sign in with?
 * Deliberately reveals nothing beyond what the page's own behaviour shows.
 */
export async function GET() {
  return NextResponse.json(
    { authConfigured: getConfiguredToken() !== null, allowUnprotected: allowUnprotected() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  const expected = getConfiguredToken();

  if (!expected) {
    return NextResponse.json(
      { error: "No OWNER_DASHBOARD_AUTH_TOKEN is configured, so there is nothing to sign in with." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  let token: unknown;
  try {
    token = (await request.json())?.token;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof token !== "string" || !tokensMatch(token, expected)) {
    return NextResponse.json(
      { error: "That token is not correct." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: expected,
    httpOnly: true,
    sameSite: "lax",
    // Only mark Secure on HTTPS; a LAN install over plain http would drop the
    // cookie otherwise and the PWA could never sign in.
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS
  });

  return response;
}

export async function DELETE(request: Request) {
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: 0
  });
  return response;
}
