import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import {
  deleteDropdownOption,
  DropdownOptionError,
  isDropdownListKey,
  listDropdownOptions,
  moveDropdownOption,
  updateDropdownOption,
  type DropdownListKey
} from "@/lib/dropdown-options";

export const dynamic = "force-dynamic";

function listKeyOrError(value: unknown): DropdownListKey {
  if (!isDropdownListKey(value)) throw new DropdownOptionError(`Unknown option list "${String(value)}".`);
  return value;
}

function failure(error: unknown) {
  const status = error instanceof DropdownOptionError ? 400 : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function PUT(request: Request, context: { params: Promise<{ optionId: string }> }) {
  try {
    const { optionId } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    const listKey = listKeyOrError(body.listKey);
    const db = getDatabase();

    if (body.move === "up" || body.move === "down") {
      return NextResponse.json(
        { options: moveDropdownOption(db, optionId, body.move), relabeledRecords: 0 },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const { option, relabeledRecords } = updateDropdownOption(db, optionId, {
      label: body.label,
      isActive: body.isActive,
      isDefault: body.isDefault
    });
    return NextResponse.json(
      { option, relabeledRecords, options: listDropdownOptions(db, listKey, { includeInactive: true }) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ optionId: string }> }) {
  try {
    const { optionId } = await context.params;
    const params = new URL(request.url).searchParams;
    const listKey = listKeyOrError(params.get("listKey"));
    const db = getDatabase();
    const { reassignedRecords } = deleteDropdownOption(db, optionId, params.get("replaceWith") ?? undefined);
    return NextResponse.json(
      { reassignedRecords, options: listDropdownOptions(db, listKey, { includeInactive: true }) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return failure(error);
  }
}
