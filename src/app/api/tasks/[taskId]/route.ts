import { NextResponse } from "next/server";
import {
  fetchClickUpJson,
  getClickUpApiKey,
  pickStatusForDone,
  putClickUpJson,
  type ClickUpList
} from "@/lib/clickup";
import { deleteCachedClickUpTask } from "@/lib/clickup-task-cache";
import { getDatabase } from "@/lib/dashboard-state";

export const dynamic = "force-dynamic";

/**
 * Writes an Up Next checkbox back to ClickUp.
 *
 * Unlike the read routes, this one never falls back: a write that quietly does
 * nothing is worse than an error, because the checkbox would claim the task was
 * closed when it is still open. Every failure is reported to the client.
 */
export async function PATCH(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await context.params;

  if (!taskId) {
    return NextResponse.json({ error: "Missing task id." }, { status: 400 });
  }

  let done: unknown;
  let listId: unknown;
  try {
    const body = await request.json();
    done = body?.done;
    listId = body?.listId;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof done !== "boolean") {
    return NextResponse.json({ error: "`done` must be a boolean." }, { status: 400 });
  }

  if (typeof listId !== "string" || !listId) {
    return NextResponse.json(
      { error: "This task has no ClickUp list, so its status cannot be resolved." },
      { status: 400 }
    );
  }

  try {
    const apiKey = await getClickUpApiKey();
    if (!apiKey) throw new Error("Missing ClickUp API key");

    // Status names are per-list, so ask the list what it actually offers
    // instead of assuming a name like "Complete" exists.
    const list = await fetchClickUpJson<ClickUpList>(`/list/${listId}`, new URLSearchParams(), apiKey);
    const status = pickStatusForDone(list.statuses, done);

    if (!status) {
      return NextResponse.json(
        {
          error: `The list "${list.name || listId}" has no ${
            done ? "closed" : "open"
          } status, so this task was left unchanged.`
        },
        { status: 422 }
      );
    }

    await putClickUpJson(`/task/${taskId}`, { status }, apiKey);
    if (done) {
      deleteCachedClickUpTask(getDatabase(), taskId);
    }

    return NextResponse.json({ ok: true, status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[owner-dashboard] failed to update ClickUp task ${taskId}: ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
