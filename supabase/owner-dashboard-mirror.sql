-- Off-site mirror of the owner dashboard's SQLite database.
--
-- SQLite on amb-ubuntu-01 stays the system of record. This schema is a copy
-- pushed by `npm run backup:supabase`, so it can be queried from anywhere and
-- survives the loss of that machine — the daily `VACUUM INTO` snapshots live
-- on the same disk as the database they protect, which is not a backup.
--
-- Apply once, in the Supabase SQL editor or via the CLI. It is idempotent:
-- re-running it adds nothing and drops nothing.
--
-- Deliberate omissions:
--   * `clickup_tasks`, `clickup_sync_state`, `mileage_route_cache` — caches,
--     rebuilt from their upstreams on demand. Copying them is noise.
--   * `app_settings` secrets — `clickup.api_key` and
--     `maps.openrouteservice.api_key` never leave the box. The push script
--     allowlists the keys it sends rather than denylisting the ones it does
--     not, so a credential added later is excluded by default rather than
--     included by accident.
--   * Receipt files. They sit beside the database on disk; only the
--     `receipt_name` / `receipt_path` references are mirrored, so a restore
--     from this schema alone has the records without the attachments.
--
-- Types mirror SQLite faithfully — text stays text (including dates, which
-- SQLite does not constrain), REAL becomes numeric, and the 0/1 integers that
-- carry CHECK constraints become real booleans. Faithful beats clever: this is
-- a restore path first and a reporting surface second.

create schema if not exists owner_dashboard;

comment on schema owner_dashboard is
  'Mirror of the owner dashboard SQLite database on amb-ubuntu-01. Written by scripts/backup-to-supabase.mjs. Not the system of record.';

-- Entities ------------------------------------------------------------------

create table if not exists owner_dashboard.clients (
  id text primary key,
  mc_id bigint,
  name text,
  status text,
  payment_type text,
  mrr numeric,
  hourly_rate numeric,
  project_est_cost numeric,
  paid_through_date text,
  invoice_status text,
  contact_name text,
  contact_email text,
  contact_phone text,
  notes text,
  is_archived boolean,
  created_at text,
  updated_at text,
  synced_at timestamptz not null default now()
);

create table if not exists owner_dashboard.projects (
  id text primary key,
  mc_id bigint,
  client_id text,
  name text,
  description text,
  hourly_rate_override numeric,
  status text,
  notes text,
  urgent boolean,
  important boolean,
  is_archived boolean,
  created_at text,
  updated_at text,
  synced_at timestamptz not null default now()
);

-- Ledgers -------------------------------------------------------------------

create table if not exists owner_dashboard.time_entries (
  id text primary key,
  mc_id bigint,
  client_id text,
  project_id text,
  date text,
  hours numeric,
  rate numeric,
  billable boolean,
  details text,
  start_time text,
  end_time text,
  created_at text,
  updated_at text,
  synced_at timestamptz not null default now()
);

create table if not exists owner_dashboard.expenses (
  id text primary key,
  mc_id bigint,
  client_id text,
  project_id text,
  recurring_expense_id text,
  date text,
  amount numeric,
  kind text,
  category text,
  company text,
  vendor text,
  details text,
  account_code text,
  billable boolean,
  reimbursable boolean,
  recurring text,
  recurring_day integer,
  payment_method text,
  status text,
  tags text,
  receipt_name text,
  receipt_path text,
  created_at text,
  updated_at text,
  synced_at timestamptz not null default now()
);

create table if not exists owner_dashboard.recurring_expenses (
  id text primary key,
  mc_id bigint,
  client_id text,
  project_id text,
  description text,
  vendor text,
  amount numeric,
  category text,
  company text,
  frequency text,
  day_of_month integer,
  start_date text,
  end_date text,
  status text,
  notes text,
  payment_method text,
  account_code text,
  created_at text,
  updated_at text,
  synced_at timestamptz not null default now()
);

create table if not exists owner_dashboard.mileage_entries (
  id text primary key,
  mc_id bigint,
  client_id text,
  project_id text,
  trip_name text,
  date text,
  start_address text,
  end_address text,
  purpose text,
  miles numeric,
  round_trip boolean,
  total_miles numeric,
  billable boolean,
  notes text,
  calculation_source text,
  calculation_provider text,
  calculated_miles numeric,
  route_metadata_json text,
  calculated_at text,
  start_place_id text,
  end_place_id text,
  created_at text,
  updated_at text,
  synced_at timestamptz not null default now()
);

-- Accounting reference ------------------------------------------------------

create table if not exists owner_dashboard.chart_accounts (
  account_code text primary key,
  mc_id bigint,
  category text,
  schedule_c_line text,
  description text,
  notes text,
  is_income boolean,
  account_type text,
  created_at text,
  updated_at text,
  synced_at timestamptz not null default now()
);

create table if not exists owner_dashboard.expense_category_accounts (
  category text primary key,
  account_code text,
  created_at text,
  updated_at text,
  synced_at timestamptz not null default now()
);

-- Manual state --------------------------------------------------------------
-- Typed in by hand and recorded nowhere else, which makes it the least
-- replaceable data here even though it is the smallest.

create table if not exists owner_dashboard.dashboard_state (
  id integer primary key,
  goals_json text,
  mrr_current text,
  mrr_projected text,
  mrr_mom_delta text,
  whats_important text,
  hyperfocus_json text,
  widget_order_json text,
  collapsed_json text,
  hidden_widgets_json text,
  updated_at text,
  synced_at timestamptz not null default now()
);

create table if not exists owner_dashboard.daily_history (
  day text primary key,
  daily_win text,
  lens text,
  target text,
  bottleneck text,
  mrr_current text,
  mrr_projected text,
  mrr_mom_delta text,
  goals_json text,
  whats_important text,
  calls_made integer,
  calls_planned integer,
  updated_at text,
  synced_at timestamptz not null default now()
);

create table if not exists owner_dashboard.phone_calls (
  id text primary key,
  column_name text,
  sort_order integer,
  name text,
  number text,
  checked boolean,
  synced_at timestamptz not null default now()
);

-- Non-secret settings and the applied migration list. The migration list is
-- small and tells a restore which schema generation the copy came from.

create table if not exists owner_dashboard.app_settings (
  key text primary key,
  value text,
  updated_at text,
  synced_at timestamptz not null default now()
);

create table if not exists owner_dashboard.schema_migrations (
  id text primary key,
  applied_at text,
  synced_at timestamptz not null default now()
);

-- Audit ---------------------------------------------------------------------
-- A backup nobody can verify is not a backup. Every run lands a row here, so
-- "when did this last succeed, and how much did it carry" is one query.

create table if not exists owner_dashboard.sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null,
  finished_at timestamptz,
  source_host text,
  status text not null,
  row_counts jsonb,
  error text
);

create index if not exists idx_sync_runs_started_at
  on owner_dashboard.sync_runs (started_at desc);

-- Access --------------------------------------------------------------------
-- This schema holds client contact details, rates, MRR, revenue, and home/
-- client addresses from the mileage log. RLS is enabled with no policies at
-- all: the service-role key used by the push script bypasses RLS, and every
-- other role — including anon, which any published key would grant — can read
-- nothing. Adding a policy here is how that stops being true.

alter table owner_dashboard.clients                   enable row level security;
alter table owner_dashboard.projects                  enable row level security;
alter table owner_dashboard.time_entries              enable row level security;
alter table owner_dashboard.expenses                  enable row level security;
alter table owner_dashboard.recurring_expenses        enable row level security;
alter table owner_dashboard.mileage_entries           enable row level security;
alter table owner_dashboard.chart_accounts            enable row level security;
alter table owner_dashboard.expense_category_accounts enable row level security;
alter table owner_dashboard.dashboard_state           enable row level security;
alter table owner_dashboard.daily_history             enable row level security;
alter table owner_dashboard.phone_calls               enable row level security;
alter table owner_dashboard.app_settings              enable row level security;
alter table owner_dashboard.schema_migrations         enable row level security;
alter table owner_dashboard.sync_runs                 enable row level security;

revoke all on all tables in schema owner_dashboard from anon, authenticated;
revoke all on schema owner_dashboard from anon, authenticated;
