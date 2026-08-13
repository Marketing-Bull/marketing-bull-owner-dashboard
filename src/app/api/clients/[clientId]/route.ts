import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import { EntityValidationError, getClient, updateClient } from "@/lib/entities";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ clientId: string }> };

export async function GET(_request: Request, context: Context) {
  const { clientId } = await context.params;
  const client = getClient(getDatabase(), clientId);
  if (!client) return NextResponse.json({ error: "No such client." }, { status: 404 });
  return NextResponse.json({ client }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request, context: Context) {
  const { clientId } = await context.params;
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    }
    const client = updateClient(getDatabase(), clientId, body);
    return NextResponse.json({ client }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof EntityValidationError) {
      const status = error.message === "No such client." ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * DELETE archives. Hard deletion does not exist for clients: later phases
 * hang time entries and expenses off these rows, and deleting one would
 * orphan financial records.
 */
export async function DELETE(_request: Request, context: Context) {
  const { clientId } = await context.params;
  try {
    const client = updateClient(getDatabase(), clientId, { isArchived: true });
    return NextResponse.json({ client }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof EntityValidationError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
