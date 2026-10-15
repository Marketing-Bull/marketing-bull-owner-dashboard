import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createClient, createProject, updateClient, updateProject } from "@/lib/entities";
import { runMigrations } from "@/lib/migrations";
import { DASHBOARD_MIGRATIONS } from "@/lib/schema";
import {
  buildLocalHoursWindows,
  createTimeEntry,
  deleteTimeEntry,
  getRecentTimeEntryDefaults,
  getTimeEntry,
  resolveLocalToday,
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
    expect(() => createTimeEntry(db, { date: "2026-08-13", hours: "0x10" as never })).toThrow(TimeEntryValidationError);
    expect(() => createTimeEntry(db, { date: "2026-08-13", hours: 1, startTime: "banana" })).toThrow(/HH:MM/i);
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

  it("rounds exact amount filters to cents and uses local created-date boundaries", () => {
    const db = freshDb();
    const entry = createTimeEntry(db, {
      date: "2026-10-15",
      hours: 1.15,
      frozenRate: 100
    });
    db.prepare("UPDATE time_entries SET created_at = ? WHERE id = ?").run(
      "2026-10-16T01:30:00.000Z",
      entry.id
    );
    const originalTimezone = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const result = queryTimeEntries(db, parseTimeEntryQuery(new URLSearchParams({
        amountMin: "115",
        amountMax: "115",
        createdFrom: "2026-10-15",
        createdTo: "2026-10-15"
      })));
      expect(result.items.map((item) => item.id)).toEqual([entry.id]);
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
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
    expect(windows.day.entries).toEqual([{ label: "Ads", hours: 1.5 }]);
    expect(windows.week.entries).toEqual([
      { label: "Site", hours: 2 },
      { label: "Ads", hours: 1.5 }
    ]);
    expect(windows.month.entries).toEqual([
      { label: "Site", hours: 5 },
      { label: "Ads", hours: 1.5 }
    ]);
    expect(windows.week.totalHours).toBe(3.5);
    expect(windows.month.totalHours).toBe(6.5);
  });

  it("keeps totals complete and separates same-named projects beyond the top six", () => {
    const db = freshDb();
    const client = createClient(db, { name: "Acme" });
    const otherClient = createClient(db, { name: "Beta" });
    for (let index = 0; index < 9; index += 1) {
      const project = createProject(db, { name: `Project ${index}`, clientId: client.id });
      createTimeEntry(db, { projectId: project.id, date: "2026-08-13", hours: 2 });
    }
    const websiteA = createProject(db, { name: "Website", clientId: client.id });
    const websiteB = createProject(db, { name: "Website", clientId: otherClient.id });
    createTimeEntry(db, { projectId: websiteA.id, date: "2026-08-13", hours: 3 });
    createTimeEntry(db, { projectId: websiteB.id, date: "2026-08-13", hours: 3 });

    const window = buildLocalHoursWindows(db, new Date(2026, 7, 13, 12)).day;
    expect(window.totalHours).toBe(24);
    expect(window.entries).toHaveLength(6);
    expect(window.entries.map((entry) => entry.label)).toContain("Website · Acme");
    expect(window.entries.map((entry) => entry.label)).toContain("Website · Beta");
  });

  it("uses a validated browser day for dashboard windows across server timezones", () => {
    const db = freshDb();
    const client = createClient(db, { name: "Acme" });
    const project = createProject(db, { name: "Site", clientId: client.id });
    createTimeEntry(db, { projectId: project.id, date: "2026-10-31", hours: 2 });
    createTimeEntry(db, { projectId: project.id, date: "2026-11-01", hours: 3 });

    const originalTimezone = process.env.TZ;
    try {
      for (const timezone of ["UTC", "America/Los_Angeles"]) {
        process.env.TZ = timezone;
        expect(buildLocalHoursWindows(db, { today: "2026-10-31" }).day.entries).toEqual([
          { label: "Site", hours: 2 }
        ]);
      }
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }

    expect(resolveLocalToday("2026-02-30", "2026-03-01")).toBe("2026-03-01");
    expect(resolveLocalToday("2026-03-02", "2026-03-01")).toBe("2026-03-02");
    expect(resolveLocalToday("2026-03-03", "2026-03-01")).toBe("2026-03-01");
  });
});

describe("audit fixes: edits keep what was saved", () => {
  it("does not re-rate a details-only edit after the project gains a client", () => {
    const db = freshDb();
    const project = createProject(db, { name: "Solo", hourlyRateOverride: 50 });
    const entry = createTimeEntry(db, { projectId: project.id, date: "2026-08-13", hours: 1 });
    expect(entry.rate).toBe(50);

    const client = createClient(db, { name: "Later", hourlyRate: 120 });
    updateProject(db, project.id, { clientId: client.id, hourlyRateOverride: 80 });

    const edited = updateTimeEntry(db, entry.id, { clientId: null, projectId: project.id, details: "Typo fix" });
    expect(edited.rate).toBe(50);
    expect(edited.details).toBe("Typo fix");
  });

  it("keeps old rows editable after their project moves to another client", () => {
    const db = freshDb();
    const first = createClient(db, { name: "First", hourlyRate: 90 });
    const second = createClient(db, { name: "Second", hourlyRate: 200 });
    const project = createProject(db, { name: "Moved", clientId: first.id });
    const entry = createTimeEntry(db, { projectId: project.id, date: "2026-08-13", hours: 1 });

    updateProject(db, project.id, { clientId: second.id });
    const edited = updateTimeEntry(db, entry.id, {
      clientId: first.id,
      projectId: project.id,
      details: "Still editable"
    });
    expect(edited.details).toBe("Still editable");
    expect(edited.rate).toBe(90);
  });

  it("picks up the current rate when a billable entry was frozen at $0", () => {
    const db = freshDb();
    const client = createClient(db, { name: "No rate yet" });
    const entry = createTimeEntry(db, { clientId: client.id, date: "2026-08-13", hours: 2 });
    expect(entry.rate).toBe(0);

    updateClient(db, client.id, { hourlyRate: 120 });
    expect(updateTimeEntry(db, entry.id, { details: "Re-save" }).rate).toBe(120);
  });

  it("saves edited start and end clocks, and clears them", () => {
    const db = freshDb();
    const entry = createTimeEntry(db, {
      date: "2026-08-13",
      hours: 1,
      startTime: "09:00",
      endTime: "10:00"
    });
    const edited = updateTimeEntry(db, entry.id, { hours: 3, startTime: "22:00", endTime: "01:00" });
    expect(edited).toMatchObject({ hours: 3, startTime: "22:00", endTime: "01:00" });
    expect(updateTimeEntry(db, entry.id, { startTime: null, endTime: null })).toMatchObject({
      startTime: null,
      endTime: null
    });
  });
});
