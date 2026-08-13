import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import { assertMapsRateLimit, autocompleteAddress, MapsError } from "@/lib/maps";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    assertMapsRateLimit(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local");
    const query = new URL(request.url).searchParams.get("q") || "";
    return NextResponse.json({ suggestions: await autocompleteAddress(getDatabase(), query) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof MapsError && (error.code === "invalid_input" || error.code === "not_configured") ? 400 : error instanceof MapsError && error.code === "rate_limited" ? 429 : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code: error instanceof MapsError ? error.code : "provider_error" }, { status });
  }
}
