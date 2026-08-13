import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createClient, createProject } from "@/lib/entities";
import { runMigrations } from "@/lib/migrations";
import { DASHBOARD_MIGRATIONS } from "@/lib/schema";
import { parseTimeEntryQuery, queryTimeEntries } from "@/lib/time-entries";

const VOLUME_ROW_COUNT = 5_000;
const QUERY_TARGET_MS = 300;

let open: DatabaseSync[] = [];

function freshVolumeDb(): DatabaseSync {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "owner-dash-time-volume-")), "dash.sqlite"));
  runMigrations(db, DASHBOARD_MIGRATIONS);
  open.push(db);

  const clients = Array.from({ length: 10 }, (_, index) =>
    createClient(db, { name: `Volume Client ${index + 1}`, hourlyRate: 100 + index * 10 })
  );
  const projects = Array.from({ length: 30 }, (_, index) => {
    const client = clients[index % clients.length]!;
    return createProject(db, { name: `Volume Project ${index + 1}`, clientId: client.id });
  });

  const insert = db.prepare(`
    INSERT INTO time_entries (
      id, mc_id, client_id, project_id, date, hours, rate, billable, details,
      start_time, end_time, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN");
  try {
    for (let index = 0; index < VOLUME_ROW_COUNT; index += 1) {
      const project = projects[index % projects.length]!;
      const client = clients[index % clients.length]!;
      const date = new Date(Date.UTC(2025, 0, 1 + (index % 365))).toISOString().slice(0, 10);
      const hours = ((index % 16) + 1) / 2;
      const rate = 100 + (index % 10) * 10;
      const billable = index % 4 === 0 ? 0 : 1;
      const details = index % 2 === 0 ? `Website campaign volume row ${index}` : `Operations volume row ${index}`;
      const createdAt = `${date}T${String(index % 24).padStart(2, "0")}:00:00.000Z`;
      insert.run(
        `volume-time-${String(index).padStart(5, "0")}`,
        100_000 + index,
        client.id,
        project.id,
        date,
        hours,
        rate,
        billable,
        details,
        index % 3 === 0 ? "09:00" : null,
        index % 3 === 0 ? "10:30" : null,
        createdAt,
        createdAt
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return db;
}

function timedQuery(db: DatabaseSync, search: string) {
  const query = parseTimeEntryQuery(new URLSearchParams(search));
  const startedAt = performance.now();
  const result = queryTimeEntries(db, query);
  return { result, elapsedMs: performance.now() - startedAt };
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

describe("time entry volume gate", () => {
  it("keeps representative 5,000-row ledger queries under the deployment target", () => {
    const db = freshVolumeDb();

    // Warm SQLite's page cache before recording the representative timings.
    timedQuery(db, "page=1&pageSize=100&sort=date&direction=desc");

    const unfiltered = timedQuery(db, "page=1&pageSize=100&sort=date&direction=desc");
    const searched = timedQuery(db, "page=1&pageSize=50&search=campaign&sort=details&direction=asc");
    const filtered = timedQuery(
      db,
      "page=1&pageSize=50&from=2025-06-01&to=2025-12-31&clientId=" +
        encodeURIComponent(unfiltered.result.availableFacets.clients[0]!.value) +
        "&billable=true&hoursMin=1&hoursMax=8&amountMin=100&details=volume&sort=amount&direction=desc"
    );
    const deepPage = timedQuery(db, "page=50&pageSize=100&sort=date&direction=desc");

    expect(unfiltered.result.items).toHaveLength(100);
    expect(unfiltered.result.pageInfo).toMatchObject({ totalItems: VOLUME_ROW_COUNT, totalPages: 50 });
    expect(unfiltered.result.filteredTotals.hours).toBeGreaterThan(0);
    expect(unfiltered.result.availableFacets.clients).toHaveLength(10);
    expect(unfiltered.result.availableFacets.projects).toHaveLength(30);
    expect(searched.result.pageInfo.totalItems).toBe(VOLUME_ROW_COUNT / 2);
    expect(filtered.result.pageInfo.totalItems).toBeGreaterThan(0);
    expect(deepPage.result.items).toHaveLength(100);
    expect(new Set(deepPage.result.items.map((entry) => entry.id)).size).toBe(100);

    const timings = [unfiltered, searched, filtered, deepPage].map(({ elapsedMs }) => elapsedMs);
    expect(Math.max(...timings)).toBeLessThan(QUERY_TARGET_MS);
  }, 15_000);
});
