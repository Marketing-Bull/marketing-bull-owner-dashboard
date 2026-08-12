import { NextResponse } from "next/server";
import { isAuthConfigured } from "@/lib/auth";
import { saveDashboardState, loadDashboardState, loadHistory } from "@/lib/dashboard-state";
import { computeStreak, todayKey } from "@/lib/history";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const today = todayKey();
    const history = loadHistory(today);

    // `authConfigured` lets the UI show that the dashboard is currently open,
    // so an unprotected deployment is visible rather than silent.
    //
    // `streak` is sent alongside the raw history rather than instead of them:
    // the client recomputes it against unsaved edits, and shipping both keeps
    // the server's own answer available to anything scripting against the API.
    return NextResponse.json(
      {
        ...loadDashboardState(),
        history,
        streak: computeStreak(history, today),
        authConfigured: isAuthConfigured()
      },
      {
        headers: { "Cache-Control": "no-store" }
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const payload = await request.json();
    return NextResponse.json(saveDashboardState(payload), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
