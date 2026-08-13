import { NextResponse } from "next/server";
import { deleteStoredMapsApiKey, setStoredMapsApiKey } from "@/lib/app-settings";
import { getDatabase } from "@/lib/dashboard-state";
import { autocompleteAddress, getMapsStatus, MapsError } from "@/lib/maps";

export const dynamic = "force-dynamic";
async function body(request: Request): Promise<Record<string, unknown>> { try { const value = await request.json(); return value && typeof value === "object" ? value as Record<string, unknown> : {}; } catch { return {}; } }
export async function GET() { return NextResponse.json(getMapsStatus(getDatabase()), { headers: { "Cache-Control": "no-store" } }); }
export async function PUT(request: Request) { try { const value = await body(request); const apiKey = typeof value.apiKey === "string" ? value.apiKey.trim() : ""; if (!apiKey) return NextResponse.json({ error: "OpenRouteService API key is required." }, { status: 400 }); setStoredMapsApiKey(getDatabase(), apiKey); return NextResponse.json(getMapsStatus(getDatabase()), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); } }
export async function DELETE() { deleteStoredMapsApiKey(getDatabase()); return NextResponse.json(getMapsStatus(getDatabase()), { headers: { "Cache-Control": "no-store" } }); }
export async function POST() { try { const suggestions = await autocompleteAddress(getDatabase(), "Miami, Florida"); return NextResponse.json({ ok: suggestions.length > 0, sample: suggestions[0]?.label ?? null }); } catch (error) { const status = error instanceof MapsError && (error.code === "not_configured" || error.code === "invalid_input") ? 400 : 502; return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status }); } }
