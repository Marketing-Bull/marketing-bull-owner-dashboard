/**
 * The migration runner, against real SQLite.
 *
 * Phases 2–4 of the consolidation add five related tables through this
 * machinery, on a live database whose financial rows cannot be regenerated.
 * The cases that matter are the failure ones: a half-applied migration, a
 * migration recorded but not run, or a list that silently reorders — each of
 * those corrupts quietly and surfaces much later as wrong data.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  appliedMigrationIds,
  runMigrations,
  validateMigrationList,
  type Migration
} from "@/lib/migrations";

let openDatabases: DatabaseSync[] = [];

function freshDatabase(): DatabaseSync {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "owner-dash-mig-")), "test.sqlite"));
  openDatabases.push(db);
  return db;
}

afterEach(() => {
  for (const db of openDatabases) {
    try {
      db.close();
    } catch {
      // already closed
    }
  }
  openDatabases = [];
});

const createA: Migration = {
  id: "001-a",
  up: (db) => db.exec("CREATE TABLE a (id INTEGER PRIMARY KEY)")
};
const createB: Migration = {
  id: "002-b",
  up: (db) => db.exec("CREATE TABLE b (id INTEGER PRIMARY KEY)")
};

function tableNames(db: DatabaseSync): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>
  )
    .map((row) => row.name)
    .sort();
}

describe("validateMigrationList", () => {
  it("accepts an ordered list and rejects duplicates, disorder, and empty ids", () => {
    expect(() => validateMigrationList([createA, createB])).not.toThrow();
    expect(() => validateMigrationList([createA, createA])).toThrow(/duplicate/i);
    expect(() => validateMigrationList([createB, createA])).toThrow(/ascending/i);
    expect(() => validateMigrationList([{ id: "  ", up: () => {} }])).toThrow(/empty/i);
  });
});

describe("runMigrations", () => {
  it("applies pending migrations in order and records them", () => {
    const db = freshDatabase();
    const applied = runMigrations(db, [createA, createB]);

    expect(applied).toEqual(["001-a", "002-b"]);
    expect(tableNames(db)).toEqual(["a", "b", "schema_migrations"]);
    expect([...appliedMigrationIds(db)].sort()).toEqual(["001-a", "002-b"]);
  });

  it("runs nothing the second time", () => {
    const db = freshDatabase();
    runMigrations(db, [createA, createB]);

    expect(runMigrations(db, [createA, createB])).toEqual([]);
  });

  it("applies only what a database is missing", () => {
    const db = freshDatabase();
    runMigrations(db, [createA]);

    expect(runMigrations(db, [createA, createB])).toEqual(["002-b"]);
    expect(tableNames(db)).toContain("b");
  });

  // The case the runner exists for: a failure must leave the database exactly
  // at the last fully applied migration — not mid-migration, and not with the
  // failed id recorded as if it had run.
  it("rolls a failing migration back and does not record it", () => {
    const db = freshDatabase();
    const exploding: Migration = {
      id: "002-explodes",
      up: (database) => {
        database.exec("CREATE TABLE half_done (id INTEGER PRIMARY KEY)");
        throw new Error("boom");
      }
    };

    expect(() => runMigrations(db, [createA, exploding])).toThrow(/002-explodes[\s\S]*boom/);

    // 001 survived; the failed migration left nothing behind.
    expect(tableNames(db)).toEqual(["a", "schema_migrations"]);
    expect([...appliedMigrationIds(db)]).toEqual(["001-a"]);

    // Fixing the migration and re-running picks up where it stopped.
    const fixed: Migration = {
      id: "002-explodes",
      up: (database) => database.exec("CREATE TABLE now_fine (id INTEGER PRIMARY KEY)")
    };
    expect(runMigrations(db, [createA, fixed])).toEqual(["002-explodes"]);
    expect(tableNames(db)).toContain("now_fine");
  });

  it("stops at the first failure rather than skipping past it", () => {
    const db = freshDatabase();
    const exploding: Migration = {
      id: "001-explodes",
      up: () => {
        throw new Error("boom");
      }
    };

    expect(() => runMigrations(db, [exploding, createB])).toThrow();
    // 002 must not have run: it may depend on 001's schema.
    expect(tableNames(db)).toEqual(["schema_migrations"]);
  });

  it("tolerates a database recorded ahead of this build", () => {
    const db = freshDatabase();
    runMigrations(db, [createA, createB]);

    // Older code that only knows 001 opens the same file: no throw, no rerun.
    expect(runMigrations(db, [createA])).toEqual([]);
  });
});
