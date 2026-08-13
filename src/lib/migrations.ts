/**
 * Ordered, recorded schema migrations.
 *
 * Until now the schema was maintained by `CREATE TABLE IF NOT EXISTS` on every
 * open plus one hand-rolled column check — two generations of ad-hoc migration
 * in a database that is about to grow clients, projects, and three entry types
 * with foreign keys between them. From here every schema change is a migration:
 * it runs exactly once, in order, inside a transaction, and is recorded in
 * `schema_migrations` so a database always knows what has been applied to it.
 *
 * The runner is deliberately dumb: no down-migrations (a single-user SQLite
 * file restores from backup instead), no branching, ids applied in list order.
 */

import type { DatabaseSync } from "node:sqlite";

export type Migration = {
  /**
   * Stable identifier, recorded on apply. Prefix with a zero-padded ordinal
   * ("001-baseline") so the list reads in execution order.
   */
  id: string;
  up: (db: DatabaseSync) => void;
};

/**
 * List-shape errors are thrown before anything runs: a migration list with a
 * duplicate or out-of-order id is a programming mistake, and applying half of
 * it first would just make the mistake harder to see.
 */
export function validateMigrationList(migrations: Migration[]): void {
  const seen = new Set<string>();
  let previous = "";

  for (const migration of migrations) {
    if (!migration.id.trim()) {
      throw new Error("Migration with an empty id.");
    }
    if (seen.has(migration.id)) {
      throw new Error(`Duplicate migration id "${migration.id}".`);
    }
    if (migration.id <= previous) {
      throw new Error(
        `Migration ids must be strictly ascending; "${migration.id}" follows "${previous}".`
      );
    }
    seen.add(migration.id);
    previous = migration.id;
  }
}

export function appliedMigrationIds(db: DatabaseSync): Set<string> {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const rows = db.prepare("SELECT id FROM schema_migrations").all() as Array<{ id?: unknown }>;
  return new Set(rows.map((row) => String(row.id)));
}

/**
 * Applies every pending migration, in order. Returns the ids it applied.
 *
 * Each migration runs in its own transaction together with the row that
 * records it, so a failure leaves the database exactly at the last fully
 * applied migration — never mid-migration, and never recorded-but-not-run.
 *
 * A recorded id this build does not know is only warned about, not fatal:
 * that is what running yesterday's code against tomorrow's database looks
 * like, and refusing to start would turn every code rollback into an outage.
 */
export function runMigrations(db: DatabaseSync, migrations: Migration[]): string[] {
  validateMigrationList(migrations);

  const applied = appliedMigrationIds(db);
  const known = new Set(migrations.map((migration) => migration.id));
  for (const id of applied) {
    if (!known.has(id)) {
      console.warn(
        `[owner-dashboard] database has migration "${id}" this build does not know — running older code against a newer database.`
      );
    }
  }

  const newlyApplied: string[] = [];
  const record = db.prepare("INSERT INTO schema_migrations (id) VALUES (?)");

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    db.exec("BEGIN");
    try {
      migration.up(db);
      record.run(migration.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration "${migration.id}" failed and was rolled back: ${reason}`);
    }

    newlyApplied.push(migration.id);
  }

  return newlyApplied;
}
