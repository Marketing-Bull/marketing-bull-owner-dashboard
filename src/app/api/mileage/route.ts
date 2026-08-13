import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import { createMileageEntry, getMileageRate, getMileageSummary, listMileageEntries, listRecentTrips, MileageValidationError } from "@/lib/mileage";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const db = getDatabase();
    return NextResponse.json({ mileageEntries: listMileageEntries(db, { from: params.get("from") || undefined,
      to: params.get("to") || undefined, limit: Number(params.get("limit") || 300) }), recentTrips: listRecentTrips(db),
      mileageRate: getMileageRate(db), summary: getMileageSummary(db) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof MileageValidationError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    const mileageEntry = createMileageEntry(getDatabase(), body as never);
    return NextResponse.json({ mileageEntry }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof MileageValidationError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
