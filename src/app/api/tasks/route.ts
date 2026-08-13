import { NextResponse } from "next/server";
import { getClickUpTaskSyncInfo } from "@/lib/clickup-task-cache";
import {
  parseClickUpTaskQuery,
  queryClickUpTasks,
  refreshTaskAssociations,
  syncClickUpTasks
} from "@/lib/clickup-tasks";
import { getDatabase } from "@/lib/dashboard-state";
import { TransactionQueryValidationError } from "@/lib/transaction-query";

export const dynamic = "force-dynamic";

/**
 * The Tasks ledger.
 *
 * Reads always answer from the local cache, so a ClickUp outage costs freshness
 * rather than the screen. `sync.error` carries the reason the last refresh
 * failed; the client shows it beside the results instead of pretending the list
 * is current.
 */
async function respond(request: Request, force: boolean) {
  const db = getDatabase();
  const sync = await syncClickUpTasks(db, { force });
  refreshTaskAssociations(db);
  const result = queryClickUpTasks(db, parseClickUpTaskQuery(new URL(request.url).searchParams));
  return NextResponse.json(
    { ...result, sync: sync.sync, syncError: sync.error, syncedAt: getClickUpTaskSyncInfo(db).lastSyncedAt },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(request: Request) {
  try {
    return await respond(request, false);
  } catch (error) {
    const status = error instanceof TransactionQueryValidationError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}

/** Explicit "Sync now": refresh the cache even when it is not yet stale. */
export async function POST(request: Request) {
  try {
    return await respond(request, true);
  } catch (error) {
    const status = error instanceof TransactionQueryValidationError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
