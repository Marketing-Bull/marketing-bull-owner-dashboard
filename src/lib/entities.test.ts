/**
 * Clients and Projects CRUD against real SQLite.
 *
 * These rows will anchor time entries and expenses in phases 3-4, so the
 * cases that matter are the ones that corrupt quietly: an archive that turns
 * into a delete, a project pointing at a client that does not exist, a rate
 * resolution that picks the wrong tier.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  createClient,
  createProject,
  EntityValidationError,
  getClient,
  listClients,
  listProjects,
  normalizeClientStatus,
  resolveHourlyRate,
  updateClient,
  updateProject
} from "@/lib/entities";
import { runMigrations } from "@/lib/migrations";
import { DASHBOARD_MIGRATIONS } from "@/lib/schema";

let open: DatabaseSync[] = [];

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "owner-dash-ent-")), "dash.sqlite"));
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

describe("normalizeClientStatus", () => {
  it("maps mission-control's live variants onto the canonical set", () => {
    expect(normalizeClientStatus("active")).toBe("active");
    expect(normalizeClientStatus("On Hold")).toBe("on_hold");
    expect(normalizeClientStatus("on hold")).toBe("on_hold");
    expect(normalizeClientStatus("prospect")).toBe("prospect");
    expect(normalizeClientStatus("ON-HOLD")).toBe("on_hold");
  });

  it("lands unknowns on active rather than inventing a status", () => {
    expect(normalizeClientStatus("churned")).toBe("active");
    expect(normalizeClientStatus("")).toBe("active");
  });
});

describe("clients", () => {
  it("round-trips a full client", () => {
    const db = freshDb();
    const created = createClient(db, {
      name: "Acme",
      status: "prospect",
      paymentType: "one-time",
      mrr: 1200,
      hourlyRate: 150,
      contactName: "Jo",
      contactEmail: "jo@acme.test",
      notes: "met at expo"
    });

    const loaded = getClient(db, created.id)!;
    expect(loaded.name).toBe("Acme");
    expect(loaded.status).toBe("prospect");
    expect(loaded.paymentType).toBe("one-time");
    expect(loaded.mrr).toBe(1200);
    expect(loaded.hourlyRate).toBe(150);
    expect(loaded.contactEmail).toBe("jo@acme.test");
    expect(loaded.isArchived).toBe(false);
    expect(loaded.mcId).toBeNull();
  });

  it("requires a name and a known status", () => {
    const db = freshDb();
    expect(() => createClient(db, { name: "   " })).toThrow(EntityValidationError);
    expect(() => createClient(db, { name: "X", status: "churned" as never })).toThrow(/status/i);
    expect(() => createClient(db, { name: "X", paymentType: "barter" as never })).toThrow(/payment/i);
  });

  it("archives instead of deleting, and the default list hides archived", () => {
    const db = freshDb();
    const client = createClient(db, { name: "Old Co" });
    createClient(db, { name: "Current Co" });

    updateClient(db, client.id, { isArchived: true });

    expect(listClients(db).map((c) => c.name)).toEqual(["Current Co"]);
    expect(listClients(db, { includeArchived: true })).toHaveLength(2);
    // The row still exists; nothing was deleted.
    expect(getClient(db, client.id)?.isArchived).toBe(true);
  });

  it("patches only the provided fields", () => {
    const db = freshDb();
    const client = createClient(db, { name: "Acme", mrr: 500, notes: "original" });
    const updated = updateClient(db, client.id, { mrr: 750 });

    expect(updated.mrr).toBe(750);
    expect(updated.notes).toBe("original");
    expect(updated.name).toBe("Acme");
  });
});

describe("projects", () => {
  it("belongs to a client and refuses a client that does not exist", () => {
    const db = freshDb();
    const client = createClient(db, { name: "Acme" });
    const project = createProject(db, { name: "Site", clientId: client.id });

    expect(project.clientId).toBe(client.id);
    expect(() => createProject(db, { name: "Bad", clientId: "nope" })).toThrow(/client/i);
  });

  it("allows unassigned projects, and carries the Eisenhower axes", () => {
    const db = freshDb();
    const project = createProject(db, { name: "Internal", urgent: true, important: false });

    expect(project.clientId).toBeNull();
    expect(project.urgent).toBe(true);
    expect(project.important).toBe(false);
  });

  it("archives instead of deleting", () => {
    const db = freshDb();
    const project = createProject(db, { name: "Done" });
    updateProject(db, project.id, { isArchived: true });

    expect(listProjects(db)).toHaveLength(0);
    expect(listProjects(db, { includeArchived: true })).toHaveLength(1);
  });
});

describe("resolveHourlyRate", () => {
  const client = { hourlyRate: 100 };
  const withOverride = { hourlyRateOverride: 150 };
  const noOverride = { hourlyRateOverride: null };

  it("prefers the project override, then the client rate, then zero", () => {
    expect(resolveHourlyRate(withOverride, client)).toBe(150);
    expect(resolveHourlyRate(noOverride, client)).toBe(100);
    expect(resolveHourlyRate(noOverride, { hourlyRate: null })).toBe(0);
    expect(resolveHourlyRate(null, null)).toBe(0);
  });

  it("treats a zero override as unset rather than billing at 0 by accident", () => {
    expect(resolveHourlyRate({ hourlyRateOverride: 0 }, client)).toBe(100);
  });
});
