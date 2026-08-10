import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { normalizeGogEvents, type GogEvent } from "@/lib/calendar-events";
import { reportFallback } from "@/lib/fallback";
import { buildSampleCalendarEvents } from "@/lib/sample-data";
import type { CalendarEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

async function loadLocalCalendarFallback(): Promise<CalendarEvent[]> {
  const raw = await readFile(join(homedir(), ".openclaw", "ui", "calendar-events.json"), "utf8");
  const data = JSON.parse(raw) as { events?: CalendarEvent[] };
  return Array.isArray(data.events) ? data.events : [];
}

export async function GET() {
  const upstream = process.env.OWNER_DASHBOARD_CALENDAR_URL?.trim();

  if (upstream) {
    try {
      const response = await fetch(upstream, {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      const json = await response.json();
      if (!response.ok) {
        return NextResponse.json(
          { error: json?.error || `Upstream calendar returned ${response.status}` },
          { status: response.status }
        );
      }
      return NextResponse.json(
        { upcomingEvents: Array.isArray(json?.upcomingEvents) ? json.upcomingEvents : [], source: "upstream" },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 }
      );
    }
  }

  try {
    const account = process.env.OWNER_DASHBOARD_CALENDAR_ACCOUNT?.trim() || "alex@getmarketingbull.com";
    const gogPath = join(homedir(), ".local", "bin", "gog");
    const { stdout } = await execFileAsync(
      gogPath,
      ["calendar", "events", "primary", "--account", account, "--json", "--no-input", "--days=5", "--max=60"],
      { timeout: 15_000 }
    );
    const parsed = JSON.parse(stdout) as { events?: GogEvent[]; items?: GogEvent[] };
    const items = Array.isArray(parsed.events) ? parsed.events : Array.isArray(parsed.items) ? parsed.items : [];
    return NextResponse.json(
      { upcomingEvents: normalizeGogEvents(items), source: "gog" },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (gogError) {
    const gogReason = reportFallback("/api/calendar (gog)", gogError);

    try {
      return NextResponse.json(
        {
          upcomingEvents: await loadLocalCalendarFallback(),
          source: "local-store",
          fallbackReason: gogReason
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch (localError) {
      const localReason = reportFallback("/api/calendar (local store)", localError);
      return NextResponse.json(
        {
          upcomingEvents: buildSampleCalendarEvents(),
          source: "sample",
          fallbackReason: `${gogReason}; local store: ${localReason}`
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
  }
}
