import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { cwd } from "node:process";
import { DEFAULT_WIDGET_ORDER, type WidgetId } from "@/lib/dashboard-layout";
import { DEFAULT_MANUAL_STATE } from "@/lib/sample-data";
import type { ManualState, PhoneCallItem } from "@/lib/types";

const DATABASE_PATH = join(cwd(), "data", "dashboard.sqlite");

type DashboardStateRow = {
  goals_json: string;
  mrr_current: string;
  mrr_projected: string;
  mrr_mom_delta: string;
  whats_important: string;
  hyperfocus_json: string;
  widget_order_json: string;
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
  `);

  return database;
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
      streakDays: typeof multiply.streakDays === "string" ? multiply.streakDays : fallback.multiply.streakDays,
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
};

export function loadDashboardState(): DashboardStatePayload {
  ensureSeedState();
  const db = getDatabase();

  const row = db.prepare(`
    SELECT goals_json, mrr_current, mrr_projected, mrr_mom_delta, whats_important, hyperfocus_json, widget_order_json
    FROM dashboard_state WHERE id = 1
  `).get() as DashboardStateRow | undefined;

  if (!row) {
    return {
      manual: DEFAULT_MANUAL_STATE,
      widgetOrder: [...DEFAULT_WIDGET_ORDER]
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
      hyperfocus: normalizeHyperfocus(JSON.parse(row.hyperfocus_json)),
      goals: normalizeGoals(JSON.parse(row.goals_json)),
      phoneCalls: mapPhoneCalls(phoneCallRows),
      whatsImportant: row.whats_important
    },
    widgetOrder: normalizeWidgetOrder(JSON.parse(row.widget_order_json))
  };
}

export function saveDashboardState(payload: DashboardStatePayload): DashboardStatePayload {
  ensureSeedState();
  const db = getDatabase();
  const manual = normalizeManualState(payload.manual);
  const widgetOrder = normalizeWidgetOrder(payload.widgetOrder);

  db.prepare(`
    UPDATE dashboard_state
    SET goals_json = ?, mrr_current = ?, mrr_projected = ?, mrr_mom_delta = ?, whats_important = ?, hyperfocus_json = ?, widget_order_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(
    JSON.stringify(manual.goals),
    manual.mrr.current,
    manual.mrr.projected,
    manual.mrr.momDelta,
    manual.whatsImportant,
    JSON.stringify(manual.hyperfocus),
    JSON.stringify(widgetOrder)
  );

  db.exec("BEGIN");
  try {
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

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { manual, widgetOrder };
}
