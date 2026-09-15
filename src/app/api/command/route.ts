import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import {
  buildCommandCenter,
  DEFAULT_COMMAND_PERIOD,
  isCommandPeriod
} from "@/lib/command-center";

export const dynamic = "force-dynamic";

/**
 * One request, one screen.
 *
 * The Command Center reads six tables to answer a single question — where the
 * business stands today — so the aggregation happens here rather than as five
 * client fetches stitched together in the browser. An unknown `period` is
 * corrected to the default instead of rejected: this endpoint only ever reads,
 * and a bookmarked link with a stale period should still render the screen.
 */
export async function GET(request: Request) {
  try {
    const requested = new URL(request.url).searchParams.get("period");
    const period = isCommandPeriod(requested) ? requested : DEFAULT_COMMAND_PERIOD;

    return NextResponse.json(buildCommandCenter(getDatabase(), { period }), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
