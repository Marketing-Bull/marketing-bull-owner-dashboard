import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient, createProject } from "@/lib/entities";
import {
  createMileageEntry,
  deleteMileageEntry,
  getMileageEntry,
  getMileageRate,
  getMileageSummary,
  listRecentTrips,
  mileageTotal,
  parseMileageQuery,
  queryMileageEntries,
  setMileageRate,
  updateMileageEntry
} from "@/lib/mileage";
import { runMigrations } from "@/lib/migrations";
import { DASHBOARD_MIGRATIONS } from "@/lib/schema";
import { setStoredMapsApiKey } from "@/lib/app-settings";
import { assertMapsRateLimit, autocompleteAddress, calculateDrivingRoutes, MapsError } from "@/lib/maps";

let open: DatabaseSync[] = [];
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "owner-dash-mileage-")), "dash.sqlite"));
  runMigrations(db, DASHBOARD_MIGRATIONS); open.push(db); return db;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); for (const db of open) try { db.close(); } catch {} open = []; });

describe("mileage", () => {
  it("computes and stores round trips instead of trusting a supplied total", () => {
    const db = freshDb();
    expect(mileageTotal(11, true)).toBe(22);
    const entry = createMileageEntry(db, { date: "2026-08-13", miles: 11, roundTrip: true, startAddress: "A", endAddress: "B" });
    expect(entry.totalMiles).toBe(22);
    expect(updateMileageEntry(db, entry.id, { roundTrip: false }).totalMiles).toBe(11);
  });

  it("stores provider route provenance while preserving manual entries", () => {
    const db = freshDb();
    const manual = createMileageEntry(db, { date: "2026-08-13", miles: 4 });
    expect(manual.calculationSource).toBe("manual");
    const provider = createMileageEntry(db, { date: "2026-08-13", miles: 8.25, calculationSource: "provider", calculationProvider: "openrouteservice", calculatedMiles: 8.25, calculatedAt: "2026-08-13T12:00:00.000Z", startPlaceId: "start", endPlaceId: "end", routeMetadataJson: "{\"routeIndex\":0}" });
    expect(provider).toMatchObject({ calculationSource: "provider", calculationProvider: "openrouteservice", calculatedMiles: 8.25, startPlaceId: "start", endPlaceId: "end" });
    expect(updateMileageEntry(db, provider.id, { miles: 9, calculationSource: "manual" })).toMatchObject({ calculationSource: "manual", calculationProvider: null, calculatedMiles: null });
  });

  it("autocompletes, calculates, and caches provider routes", async () => {
    const db = freshDb(); setStoredMapsApiKey(db, "test-key");
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      calls += 1; const value = String(url);
      if (value.includes("geocode")) return new Response(JSON.stringify({ features: [{ id: value.includes("Start") ? "start" : "end", geometry: { coordinates: value.includes("Start") ? [-80.1, 25.7] : [-80.2, 25.8] }, properties: { label: value.includes("Start") ? "Start Place" : "End Place" } }] }), { status: 200 });
      return new Response(JSON.stringify({ routes: [{ summary: { distance: 16093.44, duration: 1200 } }] }), { status: 200 });
    }));
    expect((await autocompleteAddress(db, "Start"))[0]?.label).toBe("Start Place");
    const first = await calculateDrivingRoutes(db, "Start", "End");
    expect(first.routes[0]).toMatchObject({ miles: 10, durationMinutes: 20 });
    const beforeCache = calls;
    const second = await calculateDrivingRoutes(db, "Start", "End");
    expect(second.cached).toBe(true); expect(calls).toBe(beforeCache + 2);
  });

  it("falls back to a single route when the provider rejects alternatives, and reports why it failed", async () => {
    const db = freshDb(); setStoredMapsApiKey(db, "test-key");
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      const value = String(url);
      if (value.includes("geocode")) return new Response(JSON.stringify({ features: [{ id: value.includes("Start") ? "start" : "end", geometry: { coordinates: value.includes("Start") ? [-80.1, 25.7] : [-81.5, 28.5] }, properties: { label: value.includes("Start") ? "Start Place" : "End Place" } }] }), { status: 200 });
      const body = String(init?.body ?? ""); bodies.push(body);
      if (body.includes("alternative_routes")) {
        return new Response(JSON.stringify({ error: { code: 2004, message: "Request parameters exceed the server configuration limits. The approximated route distance must not be greater than 100000.0 meters." } }), { status: 400 });
      }
      return new Response(JSON.stringify({ routes: [{ summary: { distance: 160934.4, duration: 7200 } }] }), { status: 200 });
    }));

    const result = await calculateDrivingRoutes(db, "Start", "End");
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].miles).toBe(100);
    expect(bodies.some((body) => body.includes("alternative_routes"))).toBe(true);
    expect(bodies.some((body) => !body.includes("alternative_routes"))).toBe(true);
  });

  it("surfaces the provider's own error text instead of a bare status code", async () => {
    const db = freshDb(); setStoredMapsApiKey(db, "test-key");
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (String(url).includes("geocode")) return new Response(JSON.stringify({ features: [{ id: "a", geometry: { coordinates: [-80.1, 25.7] }, properties: { label: "Somewhere" } }] }), { status: 200 });
      return new Response(JSON.stringify({ error: { code: 2010, message: "Could not find routable point within a radius of 350.0 meters of specified coordinate 1." } }), { status: 400 });
    }));
    await expect(calculateDrivingRoutes(db, "Start", "End")).rejects.toThrow(/routable point/i);
  });

  it("inherits project ownership and rejects impossible distances and mismatches", () => {
    const db = freshDb();
    const owner = createClient(db, { name: "Owner" });
    const other = createClient(db, { name: "Other" });
    const project = createProject(db, { name: "Site", clientId: owner.id });
    expect(createMileageEntry(db, { projectId: project.id, date: "2026-08-13", miles: 4 }).clientId).toBe(owner.id);
    expect(() => createMileageEntry(db, { clientId: other.id, projectId: project.id, date: "2026-08-13", miles: 4 })).toThrow(/different client/i);
    expect(() => createMileageEntry(db, { date: "2026-08-13", miles: "0x10" as never })).toThrow(/miles must be a number/i);
    expect(() => createMileageEntry(db, { date: "2026-08-13", miles: 1, routeMetadataJson: { a: 1 } as never })).toThrow(/JSON string/i);
    expect(() => createMileageEntry(db, { date: "2026-08-13", miles: 0 })).toThrow(/greater than 0/i);
  });

  it("stores the mileage rate, derives reimbursement, returns recent unique routes, and deletes", () => {
    const db = freshDb();
    expect(getMileageRate(db)).toBe(0.67);
    setMileageRate(db, 0.7);
    const first = createMileageEntry(db, { date: "2026-08-12", miles: 10, startAddress: "A", endAddress: "B" });
    createMileageEntry(db, { date: "2026-08-13", miles: 10, startAddress: "A", endAddress: "B" });
    expect(listRecentTrips(db)).toHaveLength(1);
    expect(getMileageSummary(db)).toEqual({ totalMiles: 20, reimbursement: 14, entries: 2 });
    deleteMileageEntry(db, first.id);
    expect(getMileageEntry(db, first.id)).toBeNull();
  });

  it("freezes the reimbursement rate on each trip and preserves it through edits", () => {
    const db = freshDb();
    setMileageRate(db, 0.7);
    const first = createMileageEntry(db, { date: "2026-08-12", miles: 10 });

    setMileageRate(db, 0.85);
    const second = createMileageEntry(db, { date: "2026-08-13", miles: 10 });
    const edited = updateMileageEntry(db, first.id, { date: "2027-01-01", miles: 12 });

    expect(first.rate).toBe(0.7);
    expect(second.rate).toBe(0.85);
    expect(edited.rate).toBe(0.7);
    expect(getMileageSummary(db)).toEqual({ totalMiles: 22, reimbursement: 16.9, entries: 2 });

    const result = queryMileageEntries(
      db,
      parseMileageQuery(new URLSearchParams({ reimbursementMin: "8.41", reimbursementMax: "8.6" }))
    );
    expect(result.items.map((entry) => entry.id)).toEqual([second.id]);
    expect(result.filteredTotals.reimbursement).toBe(8.5);
  });

  it("backfills existing trips with the current saved reimbursement rate", () => {
    const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "owner-dash-mileage-")), "dash.sqlite"));
    open.push(db);
    runMigrations(db, DASHBOARD_MIGRATIONS.slice(0, -1));
    const now = new Date().toISOString();
    db.prepare("UPDATE app_settings SET value = ?, updated_at = ? WHERE key = 'mileage.rate'").run("0.73", now);
    db.prepare(`INSERT INTO mileage_entries (id,date,miles,total_miles,created_at,updated_at)
      VALUES ('legacy-trip','2026-08-01',5,5,?,?)`).run(now, now);

    runMigrations(db, DASHBOARD_MIGRATIONS);
    expect(getMileageEntry(db, "legacy-trip")?.rate).toBe(0.73);
  });

  it("rejects a blank or out-of-range reimbursement rate", () => {
    const db = freshDb();
    for (const invalid of [0, -1, ""]) {
      expect(() => setMileageRate(db, invalid)).toThrow(/mileage rate/i);
    }
    expect(setMileageRate(db, 0.7)).toBe(0.7);
  });

  it("uses a bounded per-route maps bucket and resets it after the window", () => {
    vi.useFakeTimers();
    for (let request = 0; request < 30; request += 1) {
      assertMapsRateLimit("autocomplete");
    }
    expect(() => assertMapsRateLimit("autocomplete")).toThrow(MapsError);
    vi.advanceTimersByTime(60_001);
    expect(() => assertMapsRateLimit("autocomplete")).not.toThrow();
  });

  it("queries route fields, reimbursement ranges, filtered totals, and facets", () => {
    const db = freshDb();
    setMileageRate(db, 0.7);
    const client = createClient(db, { name: "Acme" });
    const project = createProject(db, { name: "Site", clientId: client.id });
    const airport = createMileageEntry(db, {
      projectId: project.id,
      date: "2026-08-12",
      tripName: "Airport run",
      startAddress: "Office",
      endAddress: "Airport",
      purpose: "Client travel",
      miles: 10,
      roundTrip: true,
      billable: true,
      notes: "Terminal 2"
    });
    createMileageEntry(db, { date: "2026-08-13", tripName: "Bank", miles: 2 });

    const result = queryMileageEntries(db, parseMileageQuery(new URLSearchParams({
      clientId: client.id,
      projectId: project.id,
      search: "airport",
      startAddress: "office",
      endAddress: "airport",
      purpose: "travel",
      milesMin: "9",
      milesMax: "11",
      roundTrip: "true",
      totalMilesMin: "20",
      billable: "true",
      notes: "terminal",
      reimbursementMin: "14",
      sort: "reimbursement"
    })));
    expect(result.items.map((entry) => entry.id)).toEqual([airport.id]);
    expect(result.filteredTotals).toEqual({ entries: 1, totalMiles: 20, reimbursement: 14 });
    expect(result.availableFacets.purposes).toEqual([{ value: "Client travel", count: 1 }]);
    expect(result.availableFacets.roundTrip).toEqual([{ value: "1", count: 1 }]);
  });

  it("validates mileage query ranges and booleans", () => {
    expect(() => parseMileageQuery(new URLSearchParams("roundTrip=sometimes"))).toThrow(/true or false/i);
    expect(() => parseMileageQuery(new URLSearchParams("milesMin=5&milesMax=2"))).toThrow(/minimum/i);
    expect(() => parseMileageQuery(new URLSearchParams("direction=sideways"))).toThrow(/one of/i);
  });
});

describe("frozen trip rate", () => {
  it("freezes the rate on create and keeps it through edits and setting changes", () => {
    const db = freshDb();
    setMileageRate(db, 0.655);
    const old = createMileageEntry(db, { date: "2023-03-01", miles: 100 });
    expect(old.rate).toBe(0.655);

    setMileageRate(db, 0.7);
    const fresh = createMileageEntry(db, { date: "2026-08-12", miles: 100 });
    expect(fresh.rate).toBe(0.7);

    // Neither a details edit nor moving the date to another year re-rates it.
    expect(updateMileageEntry(db, old.id, { notes: "Client visit" }).rate).toBe(0.655);
    expect(updateMileageEntry(db, old.id, { date: "2024-03-01" }).rate).toBe(0.655);

    expect(getMileageSummary(db).reimbursement).toBe(135.5);
    const result = queryMileageEntries(db, parseMileageQuery(new URLSearchParams()));
    expect(result.filteredTotals.reimbursement).toBe(135.5);
    const exact = queryMileageEntries(
      db,
      parseMileageQuery(new URLSearchParams({ reimbursementMin: "65.5", reimbursementMax: "65.5" }))
    );
    expect(exact.items.map((entry) => entry.id)).toEqual([old.id]);
  });

  it("backfills existing trips from the setting when the column is added", () => {
    const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "owner-dash-mrate-")), "dash.sqlite"));
    const before = DASHBOARD_MIGRATIONS.filter((migration) => migration.id !== "012-mileage-rate");
    runMigrations(db, before);
    db.prepare("UPDATE app_settings SET value = '0.7' WHERE key = 'mileage.rate'").run();
    db.prepare(
      `INSERT INTO mileage_entries (id, date, miles, round_trip, total_miles, billable, created_at, updated_at)
       VALUES ('m1', '2025-05-01', 10, 0, 10, 0, 'x', 'x')`
    ).run();

    runMigrations(db, DASHBOARD_MIGRATIONS);
    expect(getMileageEntry(db, "m1")?.rate).toBe(0.7);
    db.close();
  });

  it("backfills the default when the stored setting is unusable", () => {
    const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "owner-dash-mrate-")), "dash.sqlite"));
    runMigrations(db, DASHBOARD_MIGRATIONS.filter((migration) => migration.id !== "012-mileage-rate"));
    db.prepare("UPDATE app_settings SET value = 'abc' WHERE key = 'mileage.rate'").run();
    db.prepare(
      `INSERT INTO mileage_entries (id, date, miles, round_trip, total_miles, billable, created_at, updated_at)
       VALUES ('m1', '2025-05-01', 10, 0, 10, 0, 'x', 'x')`
    ).run();

    runMigrations(db, DASHBOARD_MIGRATIONS);
    expect(getMileageEntry(db, "m1")?.rate).toBe(0.67);
    db.close();
  });
});
