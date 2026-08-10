import { NextResponse } from "next/server";
import { saveDashboardState, loadDashboardState } from "@/lib/dashboard-state";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(loadDashboardState(), {
      headers: { "Cache-Control": "no-store" }
    });
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
