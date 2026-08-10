import { NextResponse } from "next/server";
import { buildSampleCalendarEvents } from "@/lib/sample-data";

export const dynamic = "force-dynamic";

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
        { upcomingEvents: Array.isArray(json?.upcomingEvents) ? json.upcomingEvents : [] },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    { upcomingEvents: buildSampleCalendarEvents() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
