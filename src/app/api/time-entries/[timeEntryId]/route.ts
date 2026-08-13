import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import {
  deleteTimeEntry,
  getTimeEntry,
  TimeEntryValidationError,
  updateTimeEntry
} from "@/lib/time-entries";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ timeEntryId: string }> };

export async function GET(_request: Request, context: Context) {
  const { timeEntryId } = await context.params;
  const timeEntry = getTimeEntry(getDatabase(), timeEntryId);
  if (!timeEntry) return NextResponse.json({ error: "No such time entry." }, { status: 404 });
  return NextResponse.json({ timeEntry }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request, context: Context) {
  const { timeEntryId } = await context.params;
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    const timeEntry = updateTimeEntry(getDatabase(), timeEntryId, {
      date: input.date as string | undefined,
      hours: input.hours as number | undefined,
      clientId: input.clientId as string | null | undefined,
      projectId: input.projectId as string | null | undefined,
      billable: input.billable as boolean | undefined,
      details: input.details as string | undefined
    });
    return NextResponse.json({ timeEntry }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TimeEntryValidationError) {
      const status = error.message === "No such time entry." ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { timeEntryId } = await context.params;
  try {
    deleteTimeEntry(getDatabase(), timeEntryId);
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TimeEntryValidationError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
