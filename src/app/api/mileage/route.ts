import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import {
  createMileageEntry,
  getMileageRate,
  listRecentTrips,
  MileageValidationError,
  parseMileageQuery,
  queryMileageEntries,
  type MileageInput
} from "@/lib/mileage";
import { TransactionQueryValidationError } from "@/lib/transaction-query";
import { getMapsStatus } from "@/lib/maps";

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
      summary: result.filteredTotals,
      maps: getMapsStatus(db)
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof MileageValidationError || error instanceof TransactionQueryValidationError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    const input = body as Record<string, unknown>;
    const mileageInput = {
      clientId: input.clientId,
      projectId: input.projectId,
      tripName: input.tripName,
      date: input.date,
      startAddress: input.startAddress,
      endAddress: input.endAddress,
      purpose: input.purpose,
      miles: input.miles,
      roundTrip: input.roundTrip,
      billable: input.billable,
      notes: input.notes,
      calculationSource: input.calculationSource,
      calculationProvider: input.calculationProvider,
      calculatedMiles: input.calculatedMiles,
      routeMetadataJson: input.routeMetadataJson,
      calculatedAt: input.calculatedAt
    } as MileageInput;
    const mileageEntry = createMileageEntry(getDatabase(), mileageInput);
    return NextResponse.json({ mileageEntry }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof MileageValidationError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
