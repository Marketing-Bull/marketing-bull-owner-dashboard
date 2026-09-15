import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import { assertMapsRateLimit, calculateDrivingRoutes, MapsError } from "@/lib/maps";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertMapsRateLimit(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    return NextResponse.json(await calculateDrivingRoutes(getDatabase(), body.start, body.end), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof MapsError && (error.code === "invalid_input" || error.code === "not_configured" || error.code === "no_route") ? 400 : error instanceof MapsError && error.code === "rate_limited" ? 429 : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code: error instanceof MapsError ? error.code : "provider_error" }, { status });
  }
}
