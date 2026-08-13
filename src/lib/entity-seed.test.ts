/**
 * First-boot seeding. Two properties matter:
 *
 * - a fresh database comes up populated with the imported mission-control
 *   rows (that is the whole point: deploy with zero setup), and
 * - a database with ANY entity row is never touched again — the seed must be
 *   incapable of overwriting or duplicating what the owner has since edited.
 *
 * The seed keeps mc_id, so the real mission-control import still converges
 * onto these rows if it is ever run against a fresher MC copy.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createClient, listClients, listProjects, updateClient } from "@/lib/entities";
import { SEED_CLIENTS, SEED_PROJECTS, seedEntitiesIfEmpty } from "@/lib/entity-seed";
import { runMigrations } from "@/lib/migrations";
import { DASHBOARD_MIGRATIONS } from "@/lib/schema";

let open: DatabaseSync[] = [];

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "owner-dash-seed-")), "dash.sqlite"));
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

describe("seedEntitiesIfEmpty", () => {
  it("populates a fresh database with the imported rows", () => {
    const db = freshDb();

    expect(seedEntitiesIfEmpty(db)).toBe(true);

    const clients = listClients(db, { includeArchived: true });
    const projects = listProjects(db, { includeArchived: true });
    expect(clients).toHaveLength(SEED_CLIENTS.length);
    expect(projects).toHaveLength(SEED_PROJECTS.length);
    // Provenance survives, so a later real import converges instead of duplicating.
    expect(clients.every((client) => client.mcId != null)).toBe(true);
    // Referential integrity: every assigned project points at a seeded client.
    const clientIds = new Set(clients.map((client) => client.id));
    expect(projects.every((project) => project.clientId === null || clientIds.has(project.clientId))).toBe(true);
  });

  it("runs once: the second open changes nothing, edits included", () => {
    const db = freshDb();
    seedEntitiesIfEmpty(db);

    const [first] = listClients(db);
    updateClient(db, first.id, { notes: "edited by the owner" });

    expect(seedEntitiesIfEmpty(db)).toBe(false);
    const clients = listClients(db, { includeArchived: true });
    expect(clients).toHaveLength(SEED_CLIENTS.length);
    expect(clients.find((client) => client.id === first.id)?.notes).toBe("edited by the owner");
  });

  it("never fires against a database that already has its own data", () => {
    const db = freshDb();
    createClient(db, { name: "Hand-made first" });

    expect(seedEntitiesIfEmpty(db)).toBe(false);
    expect(listClients(db, { includeArchived: true })).toHaveLength(1);
    expect(listProjects(db, { includeArchived: true })).toHaveLength(0);
  });
});
