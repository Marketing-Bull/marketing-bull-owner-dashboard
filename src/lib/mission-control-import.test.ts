/**
 * The mission-control import, against a synthetic MC database that replicates
 * the live file's schema and its dirty data (statuses in three spellings, a
 * soft-deleted project, a dangling client reference, a nameless row).
 *
 * The properties that matter: idempotence (running twice converges instead of
 * duplicating), nothing silently guessed (every fix-up is a warning), and
 * soft-deleted rows staying dead.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { listClients, listProjects } from "@/lib/entities";
import { runMigrations } from "@/lib/migrations";
import { runMissionControlImport } from "@/lib/mission-control-import";
import { DASHBOARD_MIGRATIONS } from "@/lib/schema";

let open: DatabaseSync[] = [];

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

function dashDb(): DatabaseSync {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "owner-dash-imp-")), "dash.sqlite"));
  runMigrations(db, DASHBOARD_MIGRATIONS);
  open.push(db);
  return db;
}

/** Mirrors the live MC file's relevant columns, including the drifted ones. */
function mcDb(): DatabaseSync {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "owner-dash-mc-")), "mc.sqlite"));
  db.exec(`
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, status TEXT DEFAULT 'active', mrr REAL DEFAULT 0,
      project_est_cost REAL DEFAULT 0, primary_contact TEXT, email TEXT, phone TEXT,
      notes TEXT, path TEXT, paid_through_date TEXT, invoice_status TEXT,
      next_action TEXT, is_archived INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      payment_type TEXT DEFAULT 'mrr', hourly_rate REAL DEFAULT 0,
      status_changed_at TEXT, pipeline_position INTEGER
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, status TEXT DEFAULT 'active', description TEXT, path TEXT,
      client_id INTEGER, is_deleted INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      hourly_rate REAL, session_key TEXT, rag_last_indexed TEXT
    );
  `);

  const addClient = db.prepare(
    "INSERT INTO clients (id, name, status, mrr, payment_type, primary_contact, email, phone, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  addClient.run(1, "Acme", "active", 900, "mrr", "Jo", "jo@acme.test", "555-0100", "good client", "2025-01-05 10:00:00");
  addClient.run(2, "Held Co", "On Hold", 0, "mrr", "", "", "", "", "2025-02-01 09:00:00");
  addClient.run(3, "held again", "on hold", 0, "mrr", "", "", "", "", "2025-02-02 09:00:00");
  addClient.run(4, "Maybe Inc", "prospect", 0, "one-time", "", "", "", "", "2025-03-01 09:00:00");
  addClient.run(5, "Mystery", "vip", 0, "quarterly", "", "", "", "", "2025-04-01 09:00:00");
  addClient.run(6, "   ", "active", 0, "mrr", "", "", "", "", "2025-05-01 09:00:00");

  const addProject = db.prepare(
    "INSERT INTO projects (id, name, status, description, client_id, is_deleted, hourly_rate) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  addProject.run(10, "Website", "active", "the site", 1, 0, null);
  addProject.run(11, "Rush Job", "active", "", 1, 0, 175);
  addProject.run(12, "Ghost", "active", "", 99, 0, null); // dangling client
  addProject.run(13, "Deleted", "active", "", 1, 1, null); // soft-deleted
  addProject.run(14, "Standalone", "active", "", null, 0, null);

  open.push(db);
  return db;
}

describe("runMissionControlImport", () => {
  it("imports with the cleaning rules and warns on every fix-up", () => {
    const mc = mcDb();
    const dash = dashDb();
    const summary = runMissionControlImport(mc, dash);

    expect(summary.clients).toEqual({ inserted: 5, updated: 0, skipped: 1 });
    expect(summary.projects).toEqual({ inserted: 4, updated: 0, skipped: 1 });

    const clients = listClients(dash, { includeArchived: true });
    const byName = new Map(clients.map((c) => [c.name, c]));
    expect(byName.get("Held Co")?.status).toBe("on_hold");
    expect(byName.get("held again")?.status).toBe("on_hold");
    expect(byName.get("Maybe Inc")?.status).toBe("prospect");
    expect(byName.get("Maybe Inc")?.paymentType).toBe("one-time");
    // Unknowns normalized with warnings, not guessed silently.
    expect(byName.get("Mystery")?.status).toBe("active");
    expect(byName.get("Mystery")?.paymentType).toBe("mrr");
    expect(summary.warnings.join("\n")).toMatch(/Mystery.*vip/);
    expect(summary.warnings.join("\n")).toMatch(/Mystery.*quarterly/);
    expect(summary.warnings.join("\n")).toMatch(/no name/);

    // Contact fields and provenance survive.
    expect(byName.get("Acme")?.contactName).toBe("Jo");
    expect(byName.get("Acme")?.mcId).toBe(1);
    expect(byName.get("Acme")?.createdAt).toBe("2025-01-05 10:00:00");

    const projects = listProjects(dash, { includeArchived: true });
    const projByName = new Map(projects.map((p) => [p.name, p]));
    expect(projByName.get("Website")?.clientId).toBe(byName.get("Acme")?.id);
    expect(projByName.get("Website")?.hourlyRateOverride).toBeNull();
    expect(projByName.get("Rush Job")?.hourlyRateOverride).toBe(175);
    expect(projByName.get("Ghost")?.clientId).toBeNull();
    expect(summary.warnings.join("\n")).toMatch(/Ghost.*not found/);
    expect(projByName.has("Deleted")).toBe(false);
    expect(projByName.get("Standalone")?.clientId).toBeNull();
  });

  it("is idempotent and converges on the source's newest values", () => {
    const mc = mcDb();
    const dash = dashDb();
    runMissionControlImport(mc, dash);

    // Source changes between runs, as a fresher MC copy would.
    mc.prepare("UPDATE clients SET mrr = 1200 WHERE id = 1").run();

    const second = runMissionControlImport(mc, dash);
    expect(second.clients.inserted).toBe(0);
    expect(second.clients.updated).toBe(5);
    expect(second.projects.inserted).toBe(0);

    const clients = listClients(dash, { includeArchived: true });
    expect(clients.filter((c) => c.name === "Acme")).toHaveLength(1);
    expect(clients.find((c) => c.name === "Acme")?.mrr).toBe(1200);

    // Native rows (no mc_id) are untouched by a re-run.
    const projects = listProjects(dash, { includeArchived: true });
    expect(projects.filter((p) => p.name === "Website")).toHaveLength(1);
  });
});
