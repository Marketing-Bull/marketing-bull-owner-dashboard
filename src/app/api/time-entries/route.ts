import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import {
  createTimeEntry,
  getRecentTimeEntryDefaults,
  parseTimeEntryQuery,
  queryTimeEntries,
  TimeEntryValidationError
} from "@/lib/time-entries";
import { TransactionQueryValidationError } from "@/lib/transaction-query";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const db = getDatabase();
    const result = queryTimeEntries(db, parseTimeEntryQuery(params));
    return NextResponse.json(
      {
        ...result,
        // Temporary compatibility for the current Time screen. The redesigned
        // ledger consumes `items` directly.
        timeEntries: result.items,
        recentDefaults: getRecentTimeEntryDefaults(db)
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const status =
      error instanceof TimeEntryValidationError || error instanceof TransactionQueryValidationError
        ? 400
        : 500;
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
      details: input.details as string | undefined,
      startTime: input.startTime as string | null | undefined,
      endTime: input.endTime as string | null | undefined
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
