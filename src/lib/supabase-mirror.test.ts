import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { runMigrations } from "@/lib/migrations";
import { DASHBOARD_MIGRATIONS } from "@/lib/schema";

describe("Supabase mirror schema", () => {
  it("contains every SQLite column in every mirrored table", () => {
    const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "owner-dashboard-mirror-")), "dashboard.sqlite"));
    try {
      runMigrations(db, DASHBOARD_MIGRATIONS);
      const script = readFileSync(join(process.cwd(), "scripts/backup-to-supabase.mjs"), "utf8");
      const ddl = readFileSync(join(process.cwd(), "supabase/owner-dashboard-mirror.sql"), "utf8");
      const tableList = script.match(/const TABLES = \[([\s\S]*?)\n\];/)?.[1] ?? "";
      const tables = [...tableList.matchAll(/name:\s*"([a-z_]+)"/g)].map((match) => match[1]);

      expect(tables.length).toBeGreaterThan(0);
      for (const table of tables) {
        const createTable = ddl.match(
          new RegExp(`create table if not exists owner_dashboard\\.${table} \\(([\\s\\S]*?)\\n\\);`, "i")
        )?.[1] ?? "";
        const mirrorColumns = new Set(
          [...createTable.matchAll(/^\s*([a-z_]+)\s+/gim)].map((match) => match[1])
        );
        const addedColumns = [...ddl.matchAll(
          new RegExp(`alter table owner_dashboard\\.${table}\\s+add column if not exists ([a-z_]+)`, "gi")
        )].map((match) => match[1]);
        for (const column of addedColumns) mirrorColumns.add(column);

        const sqliteColumns = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
          .map((column) => column.name);
        expect(sqliteColumns.filter((column) => !mirrorColumns.has(column)), table).toEqual([]);
      }
    } finally {
      db.close();
    }
  });
});
