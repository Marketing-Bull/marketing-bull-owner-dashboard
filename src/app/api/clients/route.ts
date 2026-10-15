import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import { createClient, EntityValidationError, listClients, type ClientInput } from "@/lib/entities";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "1";
    return NextResponse.json(
      { clients: listClients(getDatabase(), { includeArchived }) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    const clientInput = {
      name: input.name,
      status: input.status,
      paymentType: input.paymentType,
      mrr: input.mrr,
      hourlyRate: input.hourlyRate,
      projectEstCost: input.projectEstCost,
      paidThroughDate: input.paidThroughDate,
      invoiceStatus: input.invoiceStatus,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      notes: input.notes
    } as ClientInput;
    const client = createClient(getDatabase(), clientInput);
    return NextResponse.json({ client }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof EntityValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
