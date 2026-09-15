import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getStoredMapsApiKey, getStoredMapsApiKeySummary } from "@/lib/app-settings";

const PROVIDER = "openrouteservice";
const GEOCODE_URL = "https://api.openrouteservice.org/geocode";
const DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/driving-car";
const CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const buckets = new Map<string, { count: number; resetAt: number }>();

export class MapsError extends Error {
  constructor(
    message: string,
    public code: "not_configured" | "invalid_input" | "rate_limited" | "timeout" | "provider_error" | "no_route",
    /** HTTP status the provider returned, when the failure came from the provider. */
    public status: number | null = null,
    /** Provider-specific error code (OpenRouteService uses 2003, 2004, …). */
    public providerCode: number | null = null
  ) { super(message); }
}
export type PlaceSuggestion = { id: string; label: string; longitude: number; latitude: number };
export type RouteAlternative = { id: string; label: string; miles: number; durationMinutes: number; metadata: Record<string, unknown> };
export type RouteResult = { provider: string; start: PlaceSuggestion; end: PlaceSuggestion; routes: RouteAlternative[]; calculatedAt: string; cached: boolean };

export function getMapsStatus(db: DatabaseSync) {
  return { provider: PROVIDER, ...getStoredMapsApiKeySummary(db) };
}

export function assertMapsRateLimit(key: string): void {
  const now = Date.now(); const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) { buckets.set(key, { count: 1, resetAt: now + 60_000 }); return; }
  if (bucket.count >= 30) throw new MapsError("Too many route requests. Try again in a minute.", "rate_limited");
  bucket.count += 1;
}

/**
 * Pulls the provider's own explanation out of an error body.
 *
 * OpenRouteService answers `{ error: { code, message } }`, sometimes
 * `{ error: "text" }`. Without this, every rejected request reached the user as
 * a bare status code — "Maps provider request failed (400)" says nothing about
 * which input the provider refused or which limit was crossed.
 */
function providerFailure(json: unknown): { message: string; providerCode: number | null } {
  const root = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const error = root.error;
  if (typeof error === "string" && error.trim()) return { message: error.trim(), providerCode: null };
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const code = Number(record.code);
    const message = typeof record.message === "string" ? record.message.trim() : "";
    if (message) return { message, providerCode: Number.isFinite(code) ? code : null };
  }
  const message = typeof root.message === "string" ? root.message.trim() : "";
  return { message, providerCode: null };
}

async function fetchProvider<T>(url: string, init: RequestInit, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const failure = providerFailure(json);
      throw new MapsError(
        `Maps provider request failed (${response.status}).${failure.message ? ` ${failure.message}` : ""}`,
        response.status === 429 ? "rate_limited" : "provider_error",
        response.status,
        failure.providerCode
      );
    }
    return json as T;
  } catch (error) {
    if (error instanceof MapsError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new MapsError("Route calculation timed out. Enter miles manually or try again.", "timeout");
    throw new MapsError("The maps provider is unavailable. Enter miles manually or try again.", "provider_error");
  } finally { clearTimeout(timer); }
}

type GeocodeResponse = { features?: Array<{ id?: string; geometry?: { coordinates?: unknown }; properties?: { label?: string; name?: string } }> };

function placesFrom(response: GeocodeResponse): PlaceSuggestion[] {
  const places: PlaceSuggestion[] = [];
  for (const feature of response.features ?? []) {
    const coordinates = feature.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    const longitude = Number(coordinates[0]); const latitude = Number(coordinates[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    const label = feature.properties?.label?.trim() || feature.properties?.name?.trim() || "Unknown address";
    places.push({ id: feature.id || `${longitude},${latitude}`, label, longitude, latitude });
  }
  return places;
}

export async function autocompleteAddress(db: DatabaseSync, query: string): Promise<PlaceSuggestion[]> {
  const text = query.trim();
  if (text.length < 3 || text.length > 200) throw new MapsError("Enter at least 3 characters and no more than 200.", "invalid_input");
  const apiKey = getStoredMapsApiKey(db);
  if (!apiKey) throw new MapsError("Configure an OpenRouteService API key in Settings to use address search.", "not_configured");
  const params = new URLSearchParams({ api_key: apiKey, text, size: "6", "boundary.country": "US" });
  return placesFrom(await fetchProvider<GeocodeResponse>(`${GEOCODE_URL}/autocomplete?${params}`, { method: "GET" }));
}

async function resolvePlace(db: DatabaseSync, value: unknown, label: string): Promise<PlaceSuggestion> {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>; const longitude = Number(record.longitude); const latitude = Number(record.latitude);
    if (typeof record.label === "string" && record.label.trim() && Number.isFinite(longitude) && Number.isFinite(latitude)) {
      return { id: typeof record.id === "string" ? record.id : `${longitude},${latitude}`, label: record.label.trim(), longitude, latitude };
    }
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < 3 || text.length > 200) throw new MapsError(`${label} address is required.`, "invalid_input");
  const apiKey = getStoredMapsApiKey(db);
  if (!apiKey) throw new MapsError("Configure an OpenRouteService API key in Settings to calculate routes.", "not_configured");
  const params = new URLSearchParams({ api_key: apiKey, text, size: "1", "boundary.country": "US" });
  const place = placesFrom(await fetchProvider<GeocodeResponse>(`${GEOCODE_URL}/search?${params}`, { method: "GET" }))[0];
  if (!place) throw new MapsError(`No match was found for the ${label.toLowerCase()} address.`, "no_route");
  return place;
}

type DirectionsResponse = { routes?: Array<{ summary?: { distance?: number; duration?: number } }> };

function directionsBody(start: PlaceSuggestion, end: PlaceSuggestion, withAlternatives: boolean): string {
  return JSON.stringify({
    coordinates: [[start.longitude, start.latitude], [end.longitude, end.latitude]],
    instructions: false,
    ...(withAlternatives ? { alternative_routes: { target_count: 3, weight_factor: 1.4, share_factor: 0.6 } } : {})
  });
}

async function fetchDirections(apiKey: string, start: PlaceSuggestion, end: PlaceSuggestion, withAlternatives: boolean): Promise<DirectionsResponse> {
  return fetchProvider<DirectionsResponse>(DIRECTIONS_URL, {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: directionsBody(start, end, withAlternatives)
  });
}

export async function calculateDrivingRoutes(db: DatabaseSync, startValue: unknown, endValue: unknown): Promise<RouteResult> {
  const apiKey = getStoredMapsApiKey(db);
  if (!apiKey) throw new MapsError("Configure an OpenRouteService API key in Settings to calculate routes.", "not_configured");
  const [start, end] = await Promise.all([resolvePlace(db, startValue, "Start"), resolvePlace(db, endValue, "End")]);
  const cacheKey = createHash("sha256").update(`${PROVIDER}|${start.longitude.toFixed(6)},${start.latitude.toFixed(6)}|${end.longitude.toFixed(6)},${end.latitude.toFixed(6)}`).digest("hex");
  const cached = db.prepare("SELECT response_json FROM mileage_route_cache WHERE cache_key=? AND expires_at>?").get(cacheKey, new Date().toISOString()) as { response_json?: string } | undefined;
  if (cached?.response_json) { try { return { ...(JSON.parse(cached.response_json) as RouteResult), cached: true }; } catch {} }
  // Alternative routes are the most restricted part of this request: the
  // provider caps them by trip distance well below its single-route limit, so
  // an ordinary drive could fail with nothing but a 400. Alternatives are a
  // convenience — never let them cost the user the mileage they came for.
  let response: DirectionsResponse;
  try {
    response = await fetchDirections(apiKey, start, end, true);
  } catch (error) {
    if (!(error instanceof MapsError) || error.status !== 400) throw error;
    response = await fetchDirections(apiKey, start, end, false);
  }
  const routes = (response.routes ?? []).flatMap((route, index) => { const meters = Number(route.summary?.distance); const seconds = Number(route.summary?.duration); if (!(meters > 0) || !(seconds > 0)) return []; return [{ id: `${cacheKey}-${index}`, label: index === 0 ? "Recommended route" : `Alternative ${index + 1}`, miles: Number((meters / 1609.344).toFixed(2)), durationMinutes: Math.round(seconds / 60), metadata: { distanceMeters: meters, durationSeconds: seconds, routeIndex: index } }]; });
  if (!routes.length) throw new MapsError("No driving route was found. Enter miles manually.", "no_route");
  const result: RouteResult = { provider: PROVIDER, start, end, routes, calculatedAt: new Date().toISOString(), cached: false };
  db.prepare(`INSERT INTO mileage_route_cache (cache_key,provider,response_json,expires_at,created_at) VALUES (?,?,?,?,?)
    ON CONFLICT(cache_key) DO UPDATE SET response_json=excluded.response_json,expires_at=excluded.expires_at,created_at=excluded.created_at`
  ).run(cacheKey, PROVIDER, JSON.stringify(result), new Date(Date.now() + CACHE_MS).toISOString(), new Date().toISOString());
  return result;
}
