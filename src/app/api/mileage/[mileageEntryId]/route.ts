import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import { deleteMileageEntry, getMileageEntry, MileageValidationError, updateMileageEntry, type MileageInput } from "@/lib/mileage";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ mileageEntryId: string }> };

export async function GET(_request: Request, context: Context) {
  const { mileageEntryId } = await context.params;
  const mileageEntry = getMileageEntry(getDatabase(), mileageEntryId);
  return mileageEntry ? NextResponse.json({ mileageEntry }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "No such mileage entry." }, { status: 404 });
}

export async function PUT(request: Request, context: Context) {
  const { mileageEntryId } = await context.params;
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    const input = body as Record<string, unknown>;
    const patch = {
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
    } as Partial<MileageInput>;
    return NextResponse.json({ mileageEntry: updateMileageEntry(getDatabase(), mileageEntryId, patch) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof MileageValidationError ? (error.message === "No such mileage entry." ? 404 : 400) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { mileageEntryId } = await context.params;
  try {
    deleteMileageEntry(getDatabase(), mileageEntryId);
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof MileageValidationError ? 404 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
