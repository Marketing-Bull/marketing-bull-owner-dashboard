/**
 * The dashboard's schema, as an ordered migration list (see `@/lib/migrations`).
 *
 * Kept separate from `dashboard-state.ts` so anything that needs to open the
 * database with the right schema — route handlers, the mission-control
 * importer, tests — can do so without dragging in the whole state module.
 *
 * `001-baseline` is written idempotently — IF NOT EXISTS plus a conditional
 * column add — because it has to adopt live databases created across three
 * earlier schema generations as well as build a fresh file. It is the only
 * migration allowed that shape: everything after it runs against a known
 * state and must be a plain, run-once migration.
 */

import type { Migration } from "@/lib/migrations";

export const DASHBOARD_MIGRATIONS: Migration[] = [
  {
    id: "001-baseline",
    up: (db) => {
      db.exec(`
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

        -- One row per local calendar day. dashboard_state holds only the
        -- current values (id = 1), so before this table every save erased the
        -- day before it and nothing could be counted or looked back at.
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

      // Databases created before collapsed_json existed lack the column, and
      // CREATE TABLE IF NOT EXISTS above is a no-op against them.
      const columns = db.prepare("PRAGMA table_info(dashboard_state)").all() as Array<{ name?: unknown }>;
      if (!columns.some((column) => String(column.name) === "collapsed_json")) {
        db.exec("ALTER TABLE dashboard_state ADD COLUMN collapsed_json TEXT NOT NULL DEFAULT '[]'");
      }
    }
  },
  {
    // Consolidation phase 2: Clients and Projects become entities the
    // dashboard owns (decision D1/D5), shaped for the later Supabase sync
    // (D2: UUID keys, updated_at, soft delete) and carrying the billing
    // fields adopted from mission-control in phase 00.
    //
    // `mc_id` is the row's id in the retired mission-control database. It is
    // what makes the import idempotent (upsert by mc_id) and what lets the
    // phase 3-4 imports of time entries and expenses resolve their foreign
    // keys. NULL for rows created natively.
    id: "002-clients-projects",
    up: (db) => {
      db.exec(`
        CREATE TABLE clients (
          id TEXT PRIMARY KEY,
          mc_id INTEGER UNIQUE,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          payment_type TEXT NOT NULL DEFAULT 'mrr',
          mrr REAL,
          hourly_rate REAL,
          project_est_cost REAL,
          paid_through_date TEXT NOT NULL DEFAULT '',
          invoice_status TEXT NOT NULL DEFAULT '',
          contact_name TEXT NOT NULL DEFAULT '',
          contact_email TEXT NOT NULL DEFAULT '',
          contact_phone TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          is_archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          mc_id INTEGER UNIQUE,
          client_id TEXT REFERENCES clients(id),
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          hourly_rate_override REAL,
          status TEXT NOT NULL DEFAULT 'active',
          notes TEXT NOT NULL DEFAULT '',
          urgent INTEGER NOT NULL DEFAULT 0,
          important INTEGER NOT NULL DEFAULT 0,
          is_archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX idx_projects_client_id ON projects(client_id);
      `);
    }
  },
  {
    // Consolidation phase 3: time becomes a domain record owned by this app.
    // The rate is resolved when the row is saved and stored here permanently;
    // later edits to a client or project rate must not rewrite history.
    // Nullable start/end preserve mission-control's timer-shaped rows while
    // the native entry flow stays hours-first (decision D7).
    id: "003-time-entries",
    up: (db) => {
      db.exec(`
        CREATE TABLE time_entries (
          id TEXT PRIMARY KEY,
          mc_id INTEGER UNIQUE,
          client_id TEXT REFERENCES clients(id),
          project_id TEXT REFERENCES projects(id),
          date TEXT NOT NULL,
          hours REAL NOT NULL CHECK (hours > 0 AND hours <= 24),
          rate REAL NOT NULL DEFAULT 0 CHECK (rate >= 0),
          billable INTEGER NOT NULL DEFAULT 1 CHECK (billable IN (0, 1)),
          details TEXT NOT NULL DEFAULT '',
          start_time TEXT,
          end_time TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX idx_time_entries_date ON time_entries(date);
        CREATE INDEX idx_time_entries_client_id ON time_entries(client_id);
        CREATE INDEX idx_time_entries_project_id ON time_entries(project_id);
      `);
    }
  },
  {
    // ClickUp is an upstream work queue, not the local source of truth. Cache
    // assigned tasks here so the dashboard can render from SQLite, show when
    // the last sync happened, and avoid hitting ClickUp on every page load.
    id: "004-clickup-task-cache",
    up: (db) => {
      db.exec(`
        CREATE TABLE clickup_sync_state (
          source TEXT PRIMARY KEY,
          last_synced_at TEXT,
          last_attempted_at TEXT,
          status TEXT NOT NULL DEFAULT 'never' CHECK (status IN ('never', 'success', 'error')),
          error TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        );

        CREATE TABLE clickup_tasks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          url TEXT,
          due_date TEXT,
          date_updated TEXT,
          priority TEXT,
          status TEXT,
          list_id TEXT,
          list_name TEXT,
          task_type TEXT,
          raw_json TEXT NOT NULL,
          synced_at TEXT NOT NULL
        );

        CREATE INDEX idx_clickup_tasks_due_date ON clickup_tasks(due_date);
        CREATE INDEX idx_clickup_tasks_priority ON clickup_tasks(priority);
        CREATE INDEX idx_clickup_tasks_list_id ON clickup_tasks(list_id);
      `);
    }
  },
  {
    // App-owned configuration that should travel with the local SQLite store.
    // The first key is ClickUp's API token; it is read before legacy
    // environment/OpenClaw sources so Settings becomes the normal control
    // surface for the integration.
    id: "005-app-settings",
    up: (db) => {
      db.exec(`
        CREATE TABLE app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    }
  }
];
