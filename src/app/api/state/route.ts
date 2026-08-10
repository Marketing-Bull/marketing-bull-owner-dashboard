import { NextResponse } from "next/server";
import { isAuthConfigured } from "@/lib/auth";
import { saveDashboardState, loadDashboardState } from "@/lib/dashboard-state";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // `authConfigured` lets the UI show that the dashboard is currently open,
    // so an unprotected deployment is visible rather than silent.
    return NextResponse.json(
      { ...loadDashboardState(), authConfigured: isAuthConfigured() },
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
