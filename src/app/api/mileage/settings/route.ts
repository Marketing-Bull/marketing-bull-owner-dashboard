import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import { getMileageRate, MileageValidationError, setMileageRate } from "@/lib/mileage";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ mileageRate: getMileageRate(getDatabase()) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    return NextResponse.json({ mileageRate: setMileageRate(getDatabase(), (body as Record<string, unknown>).mileageRate) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof MileageValidationError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
