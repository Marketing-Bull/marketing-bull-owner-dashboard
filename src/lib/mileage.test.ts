import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
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

let open: DatabaseSync[] = [];
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "owner-dash-mileage-")), "dash.sqlite"));
  runMigrations(db, DASHBOARD_MIGRATIONS); open.push(db); return db;
}
afterEach(() => { for (const db of open) try { db.close(); } catch {} open = []; });

describe("mileage", () => {
  it("computes and stores round trips instead of trusting a supplied total", () => {
    const db = freshDb();
    expect(mileageTotal(11, true)).toBe(22);
    const entry = createMileageEntry(db, { date: "2026-08-13", miles: 11, roundTrip: true, startAddress: "A", endAddress: "B" });
    expect(entry.totalMiles).toBe(22);
    expect(updateMileageEntry(db, entry.id, { roundTrip: false }).totalMiles).toBe(11);
  });

  it("inherits project ownership and rejects impossible distances and mismatches", () => {
    const db = freshDb();
    const owner = createClient(db, { name: "Owner" });
    const other = createClient(db, { name: "Other" });
    const project = createProject(db, { name: "Site", clientId: owner.id });
    expect(createMileageEntry(db, { projectId: project.id, date: "2026-08-13", miles: 4 }).clientId).toBe(owner.id);
    expect(() => createMileageEntry(db, { clientId: other.id, projectId: project.id, date: "2026-08-13", miles: 4 })).toThrow(/different client/i);
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
