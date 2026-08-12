import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { cwd } from "node:process";
import {
  DEFAULT_WIDGET_ORDER,
  isCollapsibleId,
  type CollapsibleId,
  type WidgetId
} from "@/lib/dashboard-layout";
import {
  buildHistorySnapshot,
  HISTORY_LOOKBACK_DAYS,
  shiftDayKey,
  todayKey
} from "@/lib/history";
import { DEFAULT_MANUAL_STATE } from "@/lib/sample-data";
import type { HistoryEntry, ManualState, PhoneCallItem } from "@/lib/types";

const DATABASE_PATH = join(cwd(), "data", "dashboard.sqlite");

type DashboardStateRow = {
  goals_json: string;
  mrr_current: string;
  mrr_projected: string;
  mrr_mom_delta: string;
  whats_important: string;
  hyperfocus_json: string;
  widget_order_json: string;
  collapsed_json: string;
};

let database: DatabaseSync | null = null;

function getDatabase(): DatabaseSync {
  if (database) return database;

  mkdirSync(dirname(DATABASE_PATH), { recursive: true });
  database = new DatabaseSync(DATABASE_PATH);
  database.exec(`
    CREATE TABLE IF NOT EXISTS dashboard_state (
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

    CREATE TABLE IF NOT EXISTS phone_calls (
      id TEXT PRIMARY KEY,
      column_name TEXT NOT NULL CHECK (column_name IN ('toMake', 'made')),
      sort_order INTEGER NOT NULL,
      name TEXT NOT NULL,
      number TEXT NOT NULL,
      checked INTEGER NOT NULL DEFAULT 0
    );

    -- One row per local calendar day. dashboard_state holds only the current
    -- values (id = 1), so before this table every save erased the day before it
    -- and nothing could be counted, trended, or looked back at.
    CREATE TABLE IF NOT EXISTS daily_history (
      day TEXT PRIMARY KEY,
      daily_win TEXT NOT NULL,
      lens TEXT NOT NULL,
      target TEXT NOT NULL,
      bottleneck TEXT NOT NULL,
      mrr_current TEXT NOT NULL,
      mrr_projected TEXT NOT NULL,
      mrr_mom_delta TEXT NOT NULL,
      goals_json TEXT NOT NULL,
      whats_important TEXT NOT NULL,
      calls_made INTEGER NOT NULL,
      calls_planned INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  applyMigrations(database);

  return database;
}

/**
 * `CREATE TABLE IF NOT EXISTS` is a no-op against a database created by an
 * earlier version, so new columns have to be added explicitly or every read
 * fails with "no such column" on an existing install.
 */
function applyMigrations(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(dashboard_state)").all() as Array<{ name?: unknown }>;
  const columnNames = new Set(columns.map((column) => String(column.name)));

  if (!columnNames.has("collapsed_json")) {
    db.exec("ALTER TABLE dashboard_state ADD COLUMN collapsed_json TEXT NOT NULL DEFAULT '[]'");
  }
}

function normalizeGoals(value: unknown): ManualState["goals"] {
  const fallback = DEFAULT_MANUAL_STATE.goals;
  if (!Array.isArray(value)) return fallback;
  const values = value.map((entry) => (typeof entry === "string" ? entry : "")).slice(0, 3);
  while (values.length < 3) values.push("");
  return values as ManualState["goals"];
}

function normalizeSubtract(value: unknown): ManualState["hyperfocus"]["subtract"] {
  const fallback = DEFAULT_MANUAL_STATE.hyperfocus.subtract;
  if (!Array.isArray(value)) return fallback;
  const values = value.map((entry) => (typeof entry === "string" ? entry : "")).slice(0, 3);
  while (values.length < 3) values.push("");
  return values as ManualState["hyperfocus"]["subtract"];
}

function normalizeWidgetOrder(value: unknown): WidgetId[] {
  if (!Array.isArray(value)) return [...DEFAULT_WIDGET_ORDER];
  const valid = value.filter((entry): entry is WidgetId => DEFAULT_WIDGET_ORDER.includes(entry as WidgetId));
  const deduped = Array.from(new Set(valid));
  const missing = DEFAULT_WIDGET_ORDER.filter((id) => !deduped.includes(id));
  return [...deduped, ...missing];
}

/** Keeps only known ids, deduped, so a stale id can never hide a live panel. */
function normalizeCollapsed(value: unknown): CollapsibleId[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(isCollapsibleId)));
}

function normalizeHyperfocus(value: unknown): ManualState["hyperfocus"] {
  const fallback = DEFAULT_MANUAL_STATE.hyperfocus;
  if (!value || typeof value !== "object") return fallback;

  const candidate = value as Record<string, unknown>;
  const divide = candidate.divide && typeof candidate.divide === "object" ? candidate.divide as Record<string, unknown> : {};
  const multiply = candidate.multiply && typeof candidate.multiply === "object" ? candidate.multiply as Record<string, unknown> : {};

  return {
    lens: typeof candidate.lens === "string" ? candidate.lens : fallback.lens,
    target: typeof candidate.target === "string" ? candidate.target : fallback.target,
    why: typeof candidate.why === "string" ? candidate.why : fallback.why,
    bottleneck: typeof candidate.bottleneck === "string" ? candidate.bottleneck : fallback.bottleneck,
    subtract: normalizeSubtract(candidate.subtract),
    divide: {
      morning: typeof divide.morning === "string" ? divide.morning : fallback.divide.morning,
      midday: typeof divide.midday === "string" ? divide.midday : fallback.divide.midday,
      afternoon: typeof divide.afternoon === "string" ? divide.afternoon : fallback.divide.afternoon
    },
    multiply: {
      dailyWin: typeof multiply.dailyWin === "string" ? multiply.dailyWin : fallback.multiply.dailyWin
    }
  };
}

function normalizeManualState(value: unknown): ManualState {
  if (!value || typeof value !== "object") return DEFAULT_MANUAL_STATE;
  const candidate = value as Record<string, unknown>;
  const mrr = candidate.mrr && typeof candidate.mrr === "object" ? candidate.mrr as Record<string, unknown> : {};
  const phoneCalls =
    candidate.phoneCalls && typeof candidate.phoneCalls === "object"
      ? (candidate.phoneCalls as Record<string, unknown>)
      : {};

  const normalizePhoneCallList = (list: unknown): PhoneCallItem[] =>
    Array.isArray(list)
      ? list.map((entry, index) => {
          const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
          return {
            id:
              typeof item.id === "string" && item.id
                ? item.id
                : `call-${Date.now()}-${index}`,
            name: typeof item.name === "string" ? item.name : "",
            number: typeof item.number === "string" ? item.number : "",
            checked: Boolean(item.checked)
          };
        })
      : [];

  return {
    mrr: {
      current: typeof mrr.current === "string" ? mrr.current : DEFAULT_MANUAL_STATE.mrr.current,
      projected: typeof mrr.projected === "string" ? mrr.projected : DEFAULT_MANUAL_STATE.mrr.projected,
      momDelta: typeof mrr.momDelta === "string" ? mrr.momDelta : DEFAULT_MANUAL_STATE.mrr.momDelta
    },
    hyperfocus: normalizeHyperfocus(candidate.hyperfocus),
    goals: normalizeGoals(candidate.goals),
    phoneCalls: {
      toMake: normalizePhoneCallList(phoneCalls.toMake),
      made: normalizePhoneCallList(phoneCalls.made)
    },
    whatsImportant:
      typeof candidate.whatsImportant === "string" ? candidate.whatsImportant : DEFAULT_MANUAL_STATE.whatsImportant
  };
}

function mapPhoneCalls(rows: Array<Record<string, unknown>>): ManualState["phoneCalls"] {
  const calls: ManualState["phoneCalls"] = { toMake: [], made: [] };

  for (const row of rows) {
    const column = row.column_name === "made" ? "made" : "toMake";
    calls[column].push({
      id: String(row.id),
      name: typeof row.name === "string" ? row.name : "",
      number: typeof row.number === "string" ? row.number : "",
      checked: Boolean(row.checked)
    });
  }

  return calls;
}

function ensureSeedState(): void {
  const db = getDatabase();
  const existing = db.prepare("SELECT id FROM dashboard_state WHERE id = 1").get() as { id?: number } | undefined;
  if (existing?.id === 1) return;

  db.prepare(`
    INSERT INTO dashboard_state (
      id, goals_json, mrr_current, mrr_projected, mrr_mom_delta, whats_important, hyperfocus_json, widget_order_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    1,
    JSON.stringify(DEFAULT_MANUAL_STATE.goals),
    DEFAULT_MANUAL_STATE.mrr.current,
    DEFAULT_MANUAL_STATE.mrr.projected,
    DEFAULT_MANUAL_STATE.mrr.momDelta,
    DEFAULT_MANUAL_STATE.whatsImportant,
    JSON.stringify(DEFAULT_MANUAL_STATE.hyperfocus),
    JSON.stringify(DEFAULT_WIDGET_ORDER)
  );

  const insertCall = db.prepare(`
    INSERT INTO phone_calls (id, column_name, sort_order, name, number, checked)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const [column, entries] of Object.entries(DEFAULT_MANUAL_STATE.phoneCalls) as Array<
    [keyof ManualState["phoneCalls"], PhoneCallItem[]]
  >) {
    entries.forEach((entry, index) => {
      insertCall.run(entry.id, column, index, entry.name, entry.number, entry.checked ? 1 : 0);
    });
  }
}

export type DashboardStatePayload = {
  manual: ManualState;
  widgetOrder: WidgetId[];
  collapsed: CollapsibleId[];
};

/** A malformed JSON column must not 500 the whole dashboard. */
function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

export function loadDashboardState(): DashboardStatePayload {
  ensureSeedState();
  const db = getDatabase();

  const row = db.prepare(`
    SELECT goals_json, mrr_current, mrr_projected, mrr_mom_delta, whats_important, hyperfocus_json, widget_order_json, collapsed_json
    FROM dashboard_state WHERE id = 1
  `).get() as DashboardStateRow | undefined;

  if (!row) {
    return {
      manual: DEFAULT_MANUAL_STATE,
      widgetOrder: [...DEFAULT_WIDGET_ORDER],
      collapsed: []
    };
  }

  const phoneCallRows = db.prepare(`
    SELECT id, column_name, sort_order, name, number, checked
    FROM phone_calls
    ORDER BY column_name, sort_order
  `).all() as Array<Record<string, unknown>>;

  return {
    manual: {
      mrr: {
        current: row.mrr_current,
        projected: row.mrr_projected,
        momDelta: row.mrr_mom_delta
      },
      hyperfocus: normalizeHyperfocus(safeParse(row.hyperfocus_json)),
      goals: normalizeGoals(safeParse(row.goals_json)),
      phoneCalls: mapPhoneCalls(phoneCallRows),
      whatsImportant: row.whats_important
    },
    widgetOrder: normalizeWidgetOrder(safeParse(row.widget_order_json)),
    collapsed: normalizeCollapsed(safeParse(row.collapsed_json))
  };
}

/**
 * Reads back the last `HISTORY_LOOKBACK_DAYS` of daily rows, oldest first.
 *
 * Day keys are `YYYY-MM-DD`, so a string comparison is already chronological
 * and the window can be applied in SQL rather than after loading everything.
 */
export function loadHistory(today: string = todayKey()): HistoryEntry[] {
  const db = getDatabase();
  const cutoff = shiftDayKey(today, -HISTORY_LOOKBACK_DAYS);

  const rows = db.prepare(`
    SELECT day, daily_win, lens, target, bottleneck, mrr_current, mrr_projected, mrr_mom_delta,
           goals_json, whats_important, calls_made, calls_planned
    FROM daily_history
    WHERE day >= ?
    ORDER BY day ASC
  `).all(cutoff) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    day: String(row.day),
    dailyWin: typeof row.daily_win === "string" ? row.daily_win : "",
    lens: typeof row.lens === "string" ? row.lens : "",
    target: typeof row.target === "string" ? row.target : "",
    bottleneck: typeof row.bottleneck === "string" ? row.bottleneck : "",
    mrrCurrent: typeof row.mrr_current === "string" ? row.mrr_current : "",
    mrrProjected: typeof row.mrr_projected === "string" ? row.mrr_projected : "",
    mrrMomDelta: typeof row.mrr_mom_delta === "string" ? row.mrr_mom_delta : "",
    goals: normalizeGoals(safeParse(String(row.goals_json))),
    whatsImportant: typeof row.whats_important === "string" ? row.whats_important : "",
    callsMade: Number(row.calls_made) || 0,
    callsPlanned: Number(row.calls_planned) || 0
  }));
}

/**
 * Writes today's row, overwriting any earlier write from the same day.
 *
 * Every save rewrites today, so the row settles on wherever the day ended up.
 * Yesterday's row is never touched again -- that is the whole point of it.
 */
function recordDailySnapshot(db: DatabaseSync, manual: ManualState, day: string): void {
  const snapshot = buildHistorySnapshot(manual, day);

  db.prepare(`
    INSERT INTO daily_history (
      day, daily_win, lens, target, bottleneck, mrr_current, mrr_projected, mrr_mom_delta,
      goals_json, whats_important, calls_made, calls_planned, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(day) DO UPDATE SET
      daily_win = excluded.daily_win,
      lens = excluded.lens,
      target = excluded.target,
      bottleneck = excluded.bottleneck,
      mrr_current = excluded.mrr_current,
      mrr_projected = excluded.mrr_projected,
      mrr_mom_delta = excluded.mrr_mom_delta,
      goals_json = excluded.goals_json,
      whats_important = excluded.whats_important,
      calls_made = excluded.calls_made,
      calls_planned = excluded.calls_planned,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    snapshot.day,
    snapshot.dailyWin,
    snapshot.lens,
    snapshot.target,
    snapshot.bottleneck,
    snapshot.mrrCurrent,
    snapshot.mrrProjected,
    snapshot.mrrMomDelta,
    JSON.stringify(snapshot.goals),
    snapshot.whatsImportant,
    snapshot.callsMade,
    snapshot.callsPlanned
  );
}

export function saveDashboardState(
  payload: DashboardStatePayload,
  day: string = todayKey()
): DashboardStatePayload {
  ensureSeedState();
  const db = getDatabase();
  const manual = normalizeManualState(payload.manual);
  const widgetOrder = normalizeWidgetOrder(payload.widgetOrder);
  const collapsed = normalizeCollapsed(payload.collapsed);

  // One transaction around the whole save. Previously the dashboard_state
  // UPDATE ran before BEGIN, so a failure while rewriting phone_calls rolled
  // back only the calls and left the rest of the save applied.
  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE dashboard_state
      SET goals_json = ?, mrr_current = ?, mrr_projected = ?, mrr_mom_delta = ?, whats_important = ?, hyperfocus_json = ?, widget_order_json = ?, collapsed_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(
      JSON.stringify(manual.goals),
      manual.mrr.current,
      manual.mrr.projected,
      manual.mrr.momDelta,
      manual.whatsImportant,
      JSON.stringify(manual.hyperfocus),
      JSON.stringify(widgetOrder),
      JSON.stringify(collapsed)
    );

    db.prepare("DELETE FROM phone_calls").run();
    const insertCall = db.prepare(`
      INSERT INTO phone_calls (id, column_name, sort_order, name, number, checked)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    (Object.entries(manual.phoneCalls) as Array<[keyof ManualState["phoneCalls"], PhoneCallItem[]]>).forEach(
      ([column, entries]) => {
        entries.forEach((entry, index) => {
          insertCall.run(entry.id, column, index, entry.name, entry.number, entry.checked ? 1 : 0);
        });
      }
    );

    // Inside the same transaction as the rest of the save: a history row that
    // disagrees with the state it was taken from is worse than no row, because
    // the streak counted off it would be quietly wrong.
    recordDailySnapshot(db, manual, day);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { manual, widgetOrder, collapsed };
}
