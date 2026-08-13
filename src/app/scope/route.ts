import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cwd } from "node:process";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Serves the consolidation scope doc from its canonical location in the repo
 * (docs/), so the plan of record is one click from Settings without keeping a
 * second copy anywhere. Behind the normal gate like every other page.
 */
export async function GET() {
  try {
    const html = await readFile(join(cwd(), "docs", "dashboard-consolidation-scope.html"), "utf8");
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
    });
  } catch {
    return NextResponse.json(
      { error: "docs/dashboard-consolidation-scope.html is missing from this checkout." },
      { status: 404 }
    );
  }
}
