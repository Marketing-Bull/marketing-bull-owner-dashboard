import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import { createProject, EntityValidationError, listProjects, type ProjectInput } from "@/lib/entities";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "1";
    return NextResponse.json(
      { projects: listProjects(getDatabase(), { includeArchived }) },
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
    const projectInput = {
      name: input.name,
      clientId: input.clientId,
      description: input.description,
      hourlyRateOverride: input.hourlyRateOverride,
      status: input.status,
      notes: input.notes,
      urgent: input.urgent,
      important: input.important
    } as ProjectInput;
    const project = createProject(getDatabase(), projectInput);
    return NextResponse.json({ project }, { status: 201, headers: { "Cache-Control": "no-store" } });
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
