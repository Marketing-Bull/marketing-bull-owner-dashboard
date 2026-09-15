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
  },
  {
    // Consolidation phase 4: expenses, recurring expense definitions,
    // accounting reference data, and mileage become app-owned records.
    // The schema keeps Mission Control provenance and its richer accounting
    // fields so the later reports phase is additive rather than a re-import.
    id: "006-expenses-mileage",
    up: (db) => {
      db.exec(`
        CREATE TABLE chart_accounts (
          account_code TEXT PRIMARY KEY,
          mc_id INTEGER UNIQUE,
          category TEXT NOT NULL,
          schedule_c_line TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          is_income INTEGER NOT NULL DEFAULT 0 CHECK (is_income IN (0, 1)),
          account_type TEXT NOT NULL DEFAULT 'expense',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE expense_category_accounts (
          category TEXT PRIMARY KEY,
          account_code TEXT NOT NULL REFERENCES chart_accounts(account_code),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE recurring_expenses (
          id TEXT PRIMARY KEY,
          mc_id INTEGER UNIQUE,
          client_id TEXT REFERENCES clients(id),
          project_id TEXT REFERENCES projects(id),
          description TEXT NOT NULL,
          vendor TEXT NOT NULL DEFAULT '',
          amount REAL NOT NULL CHECK (amount >= 0),
          category TEXT NOT NULL,
          company TEXT NOT NULL DEFAULT '',
          frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')),
          day_of_month INTEGER CHECK (day_of_month IS NULL OR (day_of_month >= 1 AND day_of_month <= 31)),
          start_date TEXT NOT NULL,
          end_date TEXT,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
          notes TEXT NOT NULL DEFAULT '',
          payment_method TEXT NOT NULL DEFAULT '',
          account_code TEXT REFERENCES chart_accounts(account_code),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE expenses (
          id TEXT PRIMARY KEY,
          mc_id INTEGER UNIQUE,
          client_id TEXT REFERENCES clients(id),
          project_id TEXT REFERENCES projects(id),
          recurring_expense_id TEXT REFERENCES recurring_expenses(id) ON DELETE SET NULL,
          date TEXT NOT NULL,
          amount REAL NOT NULL CHECK (amount >= 0),
          kind TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense', 'income')),
          category TEXT NOT NULL,
          company TEXT NOT NULL DEFAULT '',
          vendor TEXT NOT NULL DEFAULT '',
          details TEXT NOT NULL DEFAULT '',
          account_code TEXT REFERENCES chart_accounts(account_code),
          billable INTEGER NOT NULL DEFAULT 0 CHECK (billable IN (0, 1)),
          reimbursable INTEGER NOT NULL DEFAULT 0 CHECK (reimbursable IN (0, 1)),
          recurring TEXT NOT NULL DEFAULT 'none' CHECK (recurring IN ('none', 'weekly', 'monthly', 'quarterly', 'yearly')),
          recurring_day INTEGER CHECK (recurring_day IS NULL OR (recurring_day >= 1 AND recurring_day <= 31)),
          payment_method TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '',
          receipt_name TEXT,
          receipt_path TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE mileage_entries (
          id TEXT PRIMARY KEY,
          mc_id INTEGER UNIQUE,
          client_id TEXT REFERENCES clients(id),
          project_id TEXT REFERENCES projects(id),
          trip_name TEXT NOT NULL DEFAULT '',
          date TEXT NOT NULL,
          start_address TEXT NOT NULL DEFAULT '',
          end_address TEXT NOT NULL DEFAULT '',
          purpose TEXT NOT NULL DEFAULT '',
          miles REAL NOT NULL CHECK (miles > 0),
          round_trip INTEGER NOT NULL DEFAULT 0 CHECK (round_trip IN (0, 1)),
          total_miles REAL NOT NULL CHECK (total_miles > 0),
          billable INTEGER NOT NULL DEFAULT 0 CHECK (billable IN (0, 1)),
          notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX idx_expenses_date ON expenses(date);
        CREATE INDEX idx_expenses_client_id ON expenses(client_id);
        CREATE INDEX idx_expenses_project_id ON expenses(project_id);
        CREATE INDEX idx_expenses_kind ON expenses(kind);
        CREATE INDEX idx_expenses_category ON expenses(category);
        CREATE INDEX idx_recurring_expenses_status ON recurring_expenses(status);
        CREATE INDEX idx_mileage_entries_date ON mileage_entries(date);
        CREATE INDEX idx_mileage_entries_client_id ON mileage_entries(client_id);
        CREATE INDEX idx_mileage_entries_project_id ON mileage_entries(project_id);

        INSERT OR IGNORE INTO app_settings (key, value, updated_at)
        VALUES ('mileage.rate', '0.67', CURRENT_TIMESTAMP);
      `);
    }
  },
  {
    // ClickUp tasks are associated automatically on each cache refresh. Source
    // hierarchy is stored for auditability; local entity ids are nullable
    // because an unmatched task must remain visible rather than be guessed.
    id: "007-clickup-task-associations",
    up: (db) => {
      db.exec(`
        ALTER TABLE clickup_tasks ADD COLUMN folder_id TEXT;
        ALTER TABLE clickup_tasks ADD COLUMN folder_name TEXT;
        ALTER TABLE clickup_tasks ADD COLUMN space_id TEXT;
        ALTER TABLE clickup_tasks ADD COLUMN space_name TEXT;
        ALTER TABLE clickup_tasks ADD COLUMN client_id TEXT REFERENCES clients(id);
        ALTER TABLE clickup_tasks ADD COLUMN project_id TEXT REFERENCES projects(id);
        ALTER TABLE clickup_tasks ADD COLUMN association_source TEXT NOT NULL DEFAULT 'none';

        CREATE INDEX idx_clickup_tasks_space_id ON clickup_tasks(space_id);
        CREATE INDEX idx_clickup_tasks_client_id ON clickup_tasks(client_id);
        CREATE INDEX idx_clickup_tasks_project_id ON clickup_tasks(project_id);
      `);
    }
  },
  {
    // Widget removal is reversible: visibility is a preference, not deletion.
    id: "008-widget-visibility",
    up: (db) => {
      db.exec("ALTER TABLE dashboard_state ADD COLUMN hidden_widgets_json TEXT NOT NULL DEFAULT '[]'");
    }
  },
  {
    // Provider-neutral Mileage route provenance. Existing rows remain manual;
    // the cache stores successful calculations only and never exposes secrets.
    id: "009-mileage-maps",
    up: (db) => {
      db.exec(`
        ALTER TABLE mileage_entries ADD COLUMN calculation_source TEXT NOT NULL DEFAULT 'manual' CHECK (calculation_source IN ('manual', 'provider'));
        ALTER TABLE mileage_entries ADD COLUMN calculation_provider TEXT;
        ALTER TABLE mileage_entries ADD COLUMN calculated_miles REAL;
        ALTER TABLE mileage_entries ADD COLUMN route_metadata_json TEXT;
        ALTER TABLE mileage_entries ADD COLUMN calculated_at TEXT;
        ALTER TABLE mileage_entries ADD COLUMN start_place_id TEXT;
        ALTER TABLE mileage_entries ADD COLUMN end_place_id TEXT;

        CREATE TABLE mileage_route_cache (
          cache_key TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          response_json TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX idx_mileage_route_cache_expires_at ON mileage_route_cache(expires_at);
      `);
    }
  },
  {
    // User-editable vocabulary (redesign plan, "Dropdowns & defaults"). One
    // normalized table keyed by `list_key` rather than a table per field, so
    // adding the next list is data, not schema. `list_key` is validated against
    // a code-owned registry in `@/lib/dropdown-options`; Settings can never
    // introduce a list the application does not already know how to use.
    //
    // Options are seeded from the categories already in use so the first render
    // of the new picker offers exactly what the imported data contains.
    id: "010-dropdown-options",
    up: (db) => {
      db.exec(`
        CREATE TABLE dropdown_options (
          id TEXT PRIMARY KEY,
          list_key TEXT NOT NULL,
          label TEXT NOT NULL,
          normalized_label TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
          is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX idx_dropdown_options_label ON dropdown_options(list_key, normalized_label);
        CREATE INDEX idx_dropdown_options_lookup ON dropdown_options(list_key, is_active, sort_order);
      `);

      const used = db.prepare(`
        SELECT MIN(label) AS label, COUNT(*) AS usage_count FROM (
          SELECT TRIM(category) AS label FROM expenses WHERE TRIM(category) <> ''
          UNION ALL
          SELECT TRIM(category) AS label FROM recurring_expenses WHERE TRIM(category) <> ''
        )
        GROUP BY LOWER(label)
        ORDER BY usage_count DESC, label COLLATE NOCASE
      `).all() as Array<{ label?: unknown }>;

      const labels = used.map((row) => String(row.label));
      // A database with no expenses yet still needs somewhere to start.
      const seeds = labels.length
        ? labels
        : ["Software", "Advertising", "Contract Labor", "Meals", "Office", "Travel", "Other"];

      const now = new Date().toISOString();
      const insert = db.prepare(`
        INSERT INTO dropdown_options (
          id, list_key, label, normalized_label, sort_order, is_active, is_default, metadata_json, created_at, updated_at
        ) VALUES (?, 'expense.category', ?, ?, ?, 1, 0, '{}', ?, ?)
      `);
      seeds.forEach((label, index) => {
        insert.run(crypto.randomUUID(), label, label.trim().toLowerCase(), index, now, now);
      });
    }
  }
];
