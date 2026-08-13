import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createClient, createProject } from "@/lib/entities";
import { createMileageEntry, deleteMileageEntry, getMileageEntry, getMileageRate, getMileageSummary, listRecentTrips, mileageTotal, setMileageRate, updateMileageEntry } from "@/lib/mileage";
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
});
