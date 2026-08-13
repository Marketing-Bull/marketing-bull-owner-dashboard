import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import {
  createMileageEntry,
  getMileageRate,
  listRecentTrips,
  MileageValidationError,
  parseMileageQuery,
  queryMileageEntries
} from "@/lib/mileage";
import { TransactionQueryValidationError } from "@/lib/transaction-query";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const db = getDatabase();
    const result = queryMileageEntries(db, parseMileageQuery(params));
    return NextResponse.json({
      ...result,
      // Temporary compatibility for the current Mileage screen.
      mileageEntries: result.items,
      recentTrips: listRecentTrips(db),
      mileageRate: getMileageRate(db),
      summary: result.filteredTotals
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof MileageValidationError || error instanceof TransactionQueryValidationError ? 400 : 500;
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
