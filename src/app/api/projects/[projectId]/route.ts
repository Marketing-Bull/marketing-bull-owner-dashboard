import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import { EntityValidationError, getProject, updateProject } from "@/lib/entities";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: Context) {
  const { projectId } = await context.params;
  const project = getProject(getDatabase(), projectId);
  if (!project) return NextResponse.json({ error: "No such project." }, { status: 404 });
  return NextResponse.json({ project }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request, context: Context) {
  const { projectId } = await context.params;
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    }
    const project = updateProject(getDatabase(), projectId, body);
    return NextResponse.json({ project }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof EntityValidationError) {
      const status = error.message === "No such project." ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/** DELETE archives, for the same reason as clients: entries will hang off these rows. */
export async function DELETE(_request: Request, context: Context) {
  const { projectId } = await context.params;
  try {
    const project = updateProject(getDatabase(), projectId, { isArchived: true });
    return NextResponse.json({ project }, { headers: { "Cache-Control": "no-store" } });
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
