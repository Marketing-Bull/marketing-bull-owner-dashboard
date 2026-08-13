import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import {
  createTimeEntry,
  getRecentTimeEntryDefaults,
  listTimeEntries,
  TimeEntryValidationError
} from "@/lib/time-entries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const from = params.get("from") || undefined;
    const to = params.get("to") || undefined;
    const limitValue = params.get("limit");
    const limit = limitValue == null ? undefined : Number(limitValue);
    const db = getDatabase();
    return NextResponse.json(
      {
        timeEntries: listTimeEntries(db, { from, to, limit }),
        recentDefaults: getRecentTimeEntryDefaults(db)
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const status = error instanceof TimeEntryValidationError ? 400 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    const timeEntry = createTimeEntry(getDatabase(), {
      date: input.date as string,
      hours: input.hours as number,
      clientId: input.clientId as string | null | undefined,
      projectId: input.projectId as string | null | undefined,
      billable: input.billable as boolean | undefined,
      details: input.details as string | undefined
    });
    return NextResponse.json(
      { timeEntry },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const status = error instanceof TimeEntryValidationError ? 400 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status }
    );
  }
}
