/**
 * Daily backup: retention rules pure, snapshot mechanics against real SQLite.
 *
 * The two failure modes worth guarding: a "backup" that is not actually a
 * readable database, and a prune that deletes something it should not — the
 * second being strictly worse than no pruning at all.
 */

import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { backupFileName, ensureDailyBackup, selectBackupsToPrune } from "@/lib/backup";

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), "owner-dash-backup-"));
}

describe("selectBackupsToPrune", () => {
  it("keeps the newest N and prunes the rest", () => {
    const names = [
      "dashboard-2026-08-10.sqlite",
      "dashboard-2026-08-12.sqlite",
      "dashboard-2026-08-09.sqlite",
      "dashboard-2026-08-11.sqlite"
    ];

    expect(selectBackupsToPrune(names, 2).sort()).toEqual([
      "dashboard-2026-08-09.sqlite",
      "dashboard-2026-08-10.sqlite"
    ]);
  });

  it("prunes nothing while at or under the limit", () => {
    expect(selectBackupsToPrune(["dashboard-2026-08-12.sqlite"], 2)).toEqual([]);
  });

  it("never selects a file that is not a backup, whatever it is named like", () => {
    const names = [
      "dashboard-2026-08-01.sqlite",
      "dashboard.sqlite", // the live database, were it ever in this directory
      "notes.txt",
      "dashboard-2026-08-01.sqlite.bak",
      "dashboard-20260801.sqlite"
    ];

    // keep=0 asks to prune everything prunable; only the real backup qualifies.
    expect(selectBackupsToPrune(names, 0)).toEqual(["dashboard-2026-08-01.sqlite"]);
  });
});

describe("ensureDailyBackup", () => {
  function seededDatabase(directory: string): DatabaseSync {
    const db = new DatabaseSync(join(directory, "dashboard.sqlite"));
    db.exec("CREATE TABLE things (id INTEGER PRIMARY KEY, value TEXT)");
    db.prepare("INSERT INTO things (value) VALUES (?)").run("survives the copy");
    return db;
  }

  it("creates a readable snapshot containing the data", () => {
    const dir = scratchDir();
    const db = seededDatabase(dir);
    const backupsDir = join(dir, "backups");

    const result = ensureDailyBackup(db, backupsDir, "2026-08-13");

    expect(result.created).toBe(true);
    expect(existsSync(join(backupsDir, backupFileName("2026-08-13")))).toBe(true);

    // Not just a file: a database that opens and holds the row.
    const restored = new DatabaseSync(join(backupsDir, backupFileName("2026-08-13")));
    const row = restored.prepare("SELECT value FROM things").get() as { value: string };
    expect(row.value).toBe("survives the copy");
    restored.close();
    db.close();
  });

  it("backs up at most once per day", () => {
    const dir = scratchDir();
    const db = seededDatabase(dir);
    const backupsDir = join(dir, "backups");

    expect(ensureDailyBackup(db, backupsDir, "2026-08-13").created).toBe(true);
    expect(ensureDailyBackup(db, backupsDir, "2026-08-13").created).toBe(false);
    expect(readdirSync(backupsDir)).toHaveLength(1);
    db.close();
  });

  it("prunes old snapshots but leaves foreign files alone", () => {
    const dir = scratchDir();
    const db = seededDatabase(dir);
    const backupsDir = join(dir, "backups");

    ensureDailyBackup(db, backupsDir, "2026-08-10", 2);
    ensureDailyBackup(db, backupsDir, "2026-08-11", 2);
    writeFileSync(join(backupsDir, "keep-me.txt"), "not a backup");
    const result = ensureDailyBackup(db, backupsDir, "2026-08-12", 2);

    expect(result.pruned).toEqual([backupFileName("2026-08-10")]);
    expect(readdirSync(backupsDir).sort()).toEqual([
      backupFileName("2026-08-11"),
      backupFileName("2026-08-12"),
      "keep-me.txt"
    ]);
    db.close();
  });
});
