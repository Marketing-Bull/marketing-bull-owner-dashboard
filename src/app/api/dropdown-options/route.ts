import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import {
  createDropdownOption,
  DROPDOWN_LISTS,
  DropdownOptionError,
  isDropdownListKey,
  listDropdownOptions,
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

export async function GET(request: Request) {
  try {
    const listKey = listKeyOrError(new URL(request.url).searchParams.get("listKey"));
    return NextResponse.json(
      {
        listKey,
        label: DROPDOWN_LISTS[listKey].label,
        options: listDropdownOptions(getDatabase(), listKey, { includeInactive: true })
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    const listKey = listKeyOrError(body.listKey);
    const db = getDatabase();
    const option = createDropdownOption(db, listKey, body.label);
    return NextResponse.json(
      { option, options: listDropdownOptions(db, listKey, { includeInactive: true }) },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return failure(error);
  }
}
