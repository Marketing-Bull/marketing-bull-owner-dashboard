import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { NextResponse } from "next/server";
import { isAuthConfigured } from "@/lib/auth";
import { getDatabase } from "@/lib/dashboard-state";
import { runMissionControlImport } from "@/lib/mission-control-import";

export const dynamic = "force-dynamic";

/**
 * Runs the mission-control import against a database file already on this
 * server. Operator flow: copy AMB-mission-control.db onto the host, then
 *
 *   curl -X POST -H "Authorization: Bearer $TOKEN" \
 *        -H "Content-Type: application/json" \
 *        -d '{"sourcePath": "/path/to/AMB-mission-control.db"}' \
 *        http://host:3018/api/admin/import-mission-control
 *
 * Idempotent: re-running against the same or a newer copy converges (upsert
 * by mc_id) rather than duplicating.
 *
 * Defense in depth on top of the proxy gate: this endpoint refuses to exist
 * unless a real token is configured. An open (opt-out) deployment must not
 * expose an endpoint that reads server-side files on request.
 */
export async function POST(request: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      { error: "Import requires OWNER_DASHBOARD_AUTH_TOKEN to be configured; it is disabled while the dashboard runs unprotected." },
      { status: 403 }
    );
  }

  let sourcePath: unknown;
  try {
    sourcePath = (await request.json())?.sourcePath;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof sourcePath !== "string" || !sourcePath.trim()) {
    return NextResponse.json({ error: "`sourcePath` must be a path to the mission-control database on this server." }, { status: 400 });
  }
  if (!existsSync(sourcePath)) {
    return NextResponse.json({ error: `No file at ${sourcePath} on this server.` }, { status: 400 });
  }

  let mc: DatabaseSync | null = null;
  try {
    mc = new DatabaseSync(sourcePath, { readOnly: true });
    // Fail with a real message if the file is not the expected database.
    mc.prepare("SELECT COUNT(*) FROM clients").get();
    mc.prepare("SELECT COUNT(*) FROM projects").get();

    const summary = runMissionControlImport(mc, getDatabase());
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Import failed: ${message}` },
      { status: 500 }
    );
  } finally {
    mc?.close();
  }
}
