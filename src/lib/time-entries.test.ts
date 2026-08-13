import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createClient, createProject, updateClient } from "@/lib/entities";
import { runMigrations } from "@/lib/migrations";
import { DASHBOARD_MIGRATIONS } from "@/lib/schema";
import {
  buildLocalHoursWindows,
  createTimeEntry,
  deleteTimeEntry,
  getRecentTimeEntryDefaults,
  getTimeEntry,
  listTimeEntries,
  parseTimeEntryQuery,
  queryTimeEntries,
  TimeEntryValidationError,
  updateTimeEntry
} from "@/lib/time-entries";

let open: DatabaseSync[] = [];

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "owner-dash-time-")), "dash.sqlite"));
  runMigrations(db, DASHBOARD_MIGRATIONS);
  open.push(db);
  return db;
}

afterEach(() => {
  for (const db of open) {
    try {
      db.close();
    } catch {
      // already closed
    }
  }
  open = [];
});

describe("time entries", () => {
  it("resolves and freezes the rate when the entry is created", () => {
    const db = freshDb();
    const client = createClient(db, { name: "Acme", hourlyRate: 100 });
    const project = createProject(db, {
      name: "Site",
      clientId: client.id,
      hourlyRateOverride: 150
    });

    const entry = createTimeEntry(db, {
      clientId: client.id,
      projectId: project.id,
      date: "2026-08-13",
      hours: 2.5,
      details: "Landing page"
    });
    expect(entry.rate).toBe(150);
    expect(entry.billable).toBe(true);

    updateClient(db, client.id, { hourlyRate: 300 });
    const edited = updateTimeEntry(db, entry.id, { details: "Landing page and QA" });
    expect(edited.rate).toBe(150);
  });

  it("re-resolves the snapshot only when its client/project relationship changes", () => {
    const db = freshDb();
    const first = createClient(db, { name: "First", hourlyRate: 90 });
    const second = createClient(db, { name: "Second", hourlyRate: 200 });
    const entry = createTimeEntry(db, { clientId: first.id, date: "2026-08-13", hours: 1 });

    expect(updateTimeEntry(db, entry.id, { clientId: second.id }).rate).toBe(200);
  });

  it("derives a missing client from the project and rejects mismatched ownership", () => {
    const db = freshDb();
    const owner = createClient(db, { name: "Owner", hourlyRate: 80 });
    const other = createClient(db, { name: "Other", hourlyRate: 120 });
    const project = createProject(db, { name: "Owned", clientId: owner.id });

    const entry = createTimeEntry(db, { projectId: project.id, date: "2026-08-13", hours: 1 });
    expect(entry.clientId).toBe(owner.id);
    expect(entry.rate).toBe(80);
    expect(() =>
      createTimeEntry(db, {
        clientId: other.id,
        projectId: project.id,
        date: "2026-08-13",
        hours: 1
      })
    ).toThrow(/different client/i);
  });

  it("validates dates and durations rather than storing unusable rows", () => {
    const db = freshDb();
    expect(() => createTimeEntry(db, { date: "10:30", hours: 1 })).toThrow(TimeEntryValidationError);
    expect(() => createTimeEntry(db, { date: "2026-02-30", hours: 1 })).toThrow(/calendar day/i);
    expect(() => createTimeEntry(db, { date: "2026-08-13", hours: 0 })).toThrow(/greater than 0/i);
    expect(() => createTimeEntry(db, { date: "2026-08-13", hours: 25 })).toThrow(/no more than 24/i);
    expect(() => createTimeEntry(db, { date: "2026-08-13", hours: 1, clientId: 4 as never })).toThrow(/client id/i);
    expect(() => createTimeEntry(db, { date: "2026-08-13", hours: 1, billable: "yes" as never })).toThrow(/true or false/i);
  });

  it("returns recent defaults, filters, and deletes explicitly", () => {
    const db = freshDb();
    const client = createClient(db, { name: "Acme" });
    createTimeEntry(db, { clientId: client.id, date: "2026-08-12", hours: 1, billable: false });
    const recent = createTimeEntry(db, { clientId: client.id, date: "2026-08-13", hours: 2 });

    expect(getRecentTimeEntryDefaults(db)).toEqual({
      clientId: client.id,
      projectId: null,
      billable: true
    });
    expect(listTimeEntries(db, { from: "2026-08-13", to: "2026-08-13" })).toHaveLength(1);
    deleteTimeEntry(db, recent.id);
    expect(getTimeEntry(db, recent.id)).toBeNull();
    expect(() => deleteTimeEntry(db, recent.id)).toThrow(/no such/i);
  });

  it("queries filtered totals, facets, deterministic pages, and every numeric range", () => {
    const db = freshDb();
    const client = createClient(db, { name: "Acme", hourlyRate: 100 });
    const project = createProject(db, { name: "Website", clientId: client.id });
    createTimeEntry(db, { projectId: project.id, date: "2026-08-11", hours: 1, billable: false, details: "Admin" });
    createTimeEntry(db, { projectId: project.id, date: "2026-08-12", hours: 2, details: "Landing page" });
    createTimeEntry(db, { date: "2026-08-13", hours: 3, details: "Internal" });

    const query = parseTimeEntryQuery(new URLSearchParams({
      page: "1",
      pageSize: "1",
      clientId: client.id,
      projectId: project.id,
      billable: "true",
      hoursMin: "1.5",
      hoursMax: "2.5",
      rateMin: "100",
      amountMin: "200",
      details: "landing",
      sort: "hours",
      direction: "asc"
    }));
    const result = queryTimeEntries(db, query);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.details).toBe("Landing page");
    expect(result.pageInfo).toMatchObject({ page: 1, pageSize: 1, totalItems: 1, totalPages: 1 });
    expect(result.filteredTotals).toEqual({ hours: 2, billableHours: 2, amount: 200, billableAmount: 200 });
    expect(result.availableFacets.clients).toEqual([{ value: client.id, count: 1 }]);
    expect(result.availableFacets.projects).toEqual([{ value: project.id, count: 1 }]);
  });

  it("rejects invalid query contracts before SQL execution", () => {
    expect(() => parseTimeEntryQuery(new URLSearchParams("billable=maybe"))).toThrow(/true or false/i);
    expect(() => parseTimeEntryQuery(new URLSearchParams("hoursMin=5&hoursMax=2"))).toThrow(/minimum/i);
    expect(() => parseTimeEntryQuery(new URLSearchParams("pageSize=101"))).toThrow(/no more than 100/i);
    expect(() => parseTimeEntryQuery(new URLSearchParams("sort=date%20DESC"))).toThrow(/one of/i);
  });

  it("builds day, week, and calendar-month dashboard rollups from local entries", () => {
    const db = freshDb();
    const client = createClient(db, { name: "Acme" });
    const site = createProject(db, { name: "Site", clientId: client.id });
    const ads = createProject(db, { name: "Ads", clientId: client.id });
    createTimeEntry(db, { projectId: site.id, date: "2026-08-10", hours: 2 });
    createTimeEntry(db, { projectId: ads.id, date: "2026-08-13", hours: 1.5 });
    createTimeEntry(db, { projectId: site.id, date: "2026-08-01", hours: 3 });
    createTimeEntry(db, { projectId: ads.id, date: "2026-07-31", hours: 4 });

    const windows = buildLocalHoursWindows(db, new Date(2026, 7, 13, 12));
    expect(windows.day).toEqual([{ label: "Ads", hours: 1.5 }]);
    expect(windows.week).toEqual([
      { label: "Site", hours: 2 },
      { label: "Ads", hours: 1.5 }
    ]);
    expect(windows.month).toEqual([
      { label: "Site", hours: 5 },
      { label: "Ads", hours: 1.5 }
    ]);
  });
});
