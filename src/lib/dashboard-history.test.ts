/**
 * The daily_history table against real SQLite.
 *
 * The pure counting rules live in history.test.ts; this covers the half that
 * only breaks in the database -- the upsert, the JSON and integer columns, and
 * the lookback window. A streak counted off rows that did not round-trip is
 * wrong in a way no amount of testing computeStreak would catch.
 *
 * The store is pointed at a temp directory via OWNER_DASHBOARD_DB_PATH (set
 * before the import; the module holds a singleton connection), so `npm test`
 * never touches the real dashboard.sqlite.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_MANUAL_STATE } from "@/lib/sample-data";
import { DEFAULT_WIDGET_ORDER } from "@/lib/dashboard-layout";
import { computeStreak } from "@/lib/history";
import type { ManualState } from "@/lib/types";

describe("daily_history end to end", () => {
  it("records, rewrites and counts real rows", async () => {
    process.env.OWNER_DASHBOARD_DB_PATH = join(
      mkdtempSync(join(tmpdir(), "owner-dash-")),
      "dashboard.sqlite"
    );
    const { saveDashboardState, loadHistory, loadDashboardState } = await import("@/lib/dashboard-state");

    const withWin = (dailyWin: string): ManualState => ({
      ...DEFAULT_MANUAL_STATE,
      hyperfocus: { ...DEFAULT_MANUAL_STATE.hyperfocus, multiply: { dailyWin } }
    });

    const payload = (manual: ManualState) => ({
      manual,
      widgetOrder: [...DEFAULT_WIDGET_ORDER],
      collapsed: []
    });

    saveDashboardState(payload(withWin("mon win")), "2026-08-10");
    saveDashboardState(payload(withWin("tue win")), "2026-08-11");
    saveDashboardState(payload(withWin("wed win")), "2026-08-12");

    let history = loadHistory("2026-08-12");
    expect(history.map((entry) => entry.day)).toEqual(["2026-08-10", "2026-08-11", "2026-08-12"]);
    expect(history.map((entry) => entry.dailyWin)).toEqual(["mon win", "tue win", "wed win"]);
    expect(computeStreak(history, "2026-08-12")).toBe(3);

    // Same day twice must update, not duplicate or throw on the PK.
    saveDashboardState(payload(withWin("wed win, revised")), "2026-08-12");
    history = loadHistory("2026-08-12");
    expect(history).toHaveLength(3);
    expect(history[2].dailyWin).toBe("wed win, revised");

    // Round-trip of the non-string columns and the goals JSON.
    expect(history[2].goals).toEqual(DEFAULT_MANUAL_STATE.goals);
    expect(history[2].callsMade).toBe(DEFAULT_MANUAL_STATE.phoneCalls.made.length);
    expect(history[2].callsPlanned).toBe(DEFAULT_MANUAL_STATE.phoneCalls.toMake.length);
    expect(history[2].mrrCurrent).toBe(DEFAULT_MANUAL_STATE.mrr.current);

    // The lookback window must exclude rows older than it.
    expect(loadHistory("2028-08-12")).toHaveLength(0);

    // A blank win breaks the run.
    saveDashboardState(payload(withWin("")), "2026-08-12");
    expect(computeStreak(loadHistory("2026-08-12"), "2026-08-12")).toBe(2);

    // The ordinary state save still works alongside the history write.
    expect(loadDashboardState().manual.hyperfocus.multiply.dailyWin).toBe("");
  });
});
