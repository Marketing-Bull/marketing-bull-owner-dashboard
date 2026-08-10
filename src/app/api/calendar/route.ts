import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { reportFallback } from "@/lib/fallback";
import { buildSampleCalendarEvents } from "@/lib/sample-data";
import type { CalendarEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

type GogEvent = {
  id?: string;
  summary?: string;
  htmlLink?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

function parseEventDate(value?: { dateTime?: string; date?: string }): number {
  if (!value) return 0;
  if (value.dateTime) return new Date(value.dateTime).getTime();
  if (value.date) {
    // An all-day "2026-08-10" parses as UTC midnight via the Date constructor,
    // which is the previous local day west of UTC. Build it as local midnight
    // so it groups under the day Google actually means.
    const [year, month, day] = value.date.split("-").map(Number);
    if ([year, month, day].every((part) => Number.isFinite(part))) {
      return new Date(year, month - 1, day).getTime();
    }
    return new Date(value.date).getTime();
  }
  return 0;
}

function normalizeGogEvents(items: GogEvent[]): CalendarEvent[] {
  return items
    .map((event) => {
      const startMs = parseEventDate(event.start);
      const endMs = parseEventDate(event.end) || startMs + 30 * 60 * 1000;
      return {
        id: event.id || `${startMs}-${event.summary || "event"}`,
        title: event.summary || "(No title)",
        startMs,
        endMs,
        allDay: Boolean(event.start?.date && !event.start?.dateTime),
        calendarName: "Google Calendar",
        location: event.location || undefined,
        href: event.htmlLink || undefined
      };
    })
    .filter((event) => Number.isFinite(event.startMs) && event.startMs > 0)
    .sort((a, b) => a.startMs - b.startMs);
}

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
