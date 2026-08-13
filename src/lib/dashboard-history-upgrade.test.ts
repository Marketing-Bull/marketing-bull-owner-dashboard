/**
 * Upgrading an install whose database predates daily_history.
 *
 * This is the failure this codebase has already had once: `CREATE TABLE IF NOT
 * EXISTS` is a no-op against an older database, which is why applyMigrations()
 * exists at all. The live dashboard runs off a data/dashboard.sqlite that has
 * been accumulating since before any of this existed, so "works on a fresh
 * database" proves nothing about the only database that matters.
 *
 * Separate file from dashboard-history.test.ts on purpose: each needs its own
 * OWNER_DASHBOARD_DB_PATH in place before the first import of dashboard-state,
 * and the module cache (with its singleton connection) is shared within a file.
 *
 * This now also covers migration-runner adoption: the old database predates
 * schema_migrations itself, so opening it must apply and record the baseline
 * without disturbing the existing rows.
 */

import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DEFAULT_MANUAL_STATE } from "@/lib/sample-data";
import { DEFAULT_WIDGET_ORDER } from "@/lib/dashboard-layout";

describe("existing database without daily_history", () => {
  it("gains the table and keeps its old rows", async () => {
    const root = mkdtempSync(join(tmpdir(), "owner-dash-old-"));
    mkdirSync(join(root, "data"), { recursive: true });

    // The pre-history schema, written by hand exactly as the old code had it.
    const old = new DatabaseSync(join(root, "data", "dashboard.sqlite"));
    old.exec(`
      CREATE TABLE dashboard_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        goals_json TEXT NOT NULL,
        mrr_current TEXT NOT NULL,
        mrr_projected TEXT NOT NULL,
        mrr_mom_delta TEXT NOT NULL,
        whats_important TEXT NOT NULL,
        hyperfocus_json TEXT NOT NULL,
        widget_order_json TEXT NOT NULL,
        collapsed_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE phone_calls (
        id TEXT PRIMARY KEY,
        column_name TEXT NOT NULL CHECK (column_name IN ('toMake', 'made')),
        sort_order INTEGER NOT NULL,
        name TEXT NOT NULL,
        number TEXT NOT NULL,
        checked INTEGER NOT NULL DEFAULT 0
      );
    `);
    old.prepare(`
      INSERT INTO dashboard_state (id, goals_json, mrr_current, mrr_projected, mrr_mom_delta,
        whats_important, hyperfocus_json, widget_order_json)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      JSON.stringify(["kept goal a", "kept goal b", "kept goal c"]),
      "99000",
      "101000",
      "3.3",
      "kept whats important",
      // Old hyperfocus JSON still carries the retired streakDays field.
      JSON.stringify({ ...DEFAULT_MANUAL_STATE.hyperfocus, multiply: { streakDays: "5", dailyWin: "kept win" } }),
      JSON.stringify(DEFAULT_WIDGET_ORDER)
    );
    old.close();

    process.env.OWNER_DASHBOARD_DB_PATH = join(root, "data", "dashboard.sqlite");
    const { loadDashboardState, loadHistory, saveDashboardState } = await import("@/lib/dashboard-state");

    // Reading an old database must not fail on the missing table...
    const state = loadDashboardState();
    expect(state.manual.mrr.current).toBe("99000");
    expect(state.manual.whatsImportant).toBe("kept whats important");
    expect(state.manual.goals[0]).toBe("kept goal a");
    expect(state.manual.hyperfocus.multiply.dailyWin).toBe("kept win");
    // The retired field is dropped on read rather than carried forward.
    expect("streakDays" in state.manual.hyperfocus.multiply).toBe(false);

    // ...and history starts empty rather than erroring.
    expect(loadHistory("2026-08-12")).toEqual([]);

    // The first save on the upgraded database begins the record.
    saveDashboardState(
      { manual: state.manual, widgetOrder: state.widgetOrder, collapsed: state.collapsed },
      "2026-08-12"
    );
    expect(loadHistory("2026-08-12").map((entry) => entry.dailyWin)).toEqual(["kept win"]);

    // The runner adopted the legacy file: baseline recorded, rows intact.
    const upgraded = new DatabaseSync(join(root, "data", "dashboard.sqlite"));
    const recorded = upgraded
      .prepare("SELECT id FROM schema_migrations ORDER BY id")
      .all() as Array<{ id: string }>;
    expect(recorded.map((row) => row.id)).toEqual(["001-baseline"]);
    upgraded.close();

    // And the first save also produced the day's backup next to the database.
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(root, "data", "backups", "dashboard-2026-08-12.sqlite"))).toBe(true);
  });
});
