# Marketing Bull Owner Dashboard

Standalone daily owner dashboard for Alex.

## The Consolidation Plan

The dashboard is mid-way through absorbing Recoup's and Mission Control's
client / project / time / expense / mileage model and becoming the single
system of record. The full scope — decisions, target schema, phase status —
lives at [`docs/dashboard-consolidation-scope.html`](docs/dashboard-consolidation-scope.html)
(open it in a browser). Phases 0–4 are done: Clients, Projects, Time, Expenses,
recurring costs, accounting references, and Mileage are owned locally. The
verified live source imported 98 time rows, 708 financial records, 13 recurring
definitions, and 4 trips on 2026-08-13. Next comes Calendar views.

## What It Is

- Lightweight Next.js app with one main dashboard screen
- Built as a standalone replacement for the heavier Mission Control route
- Designed as a compact daily command center for projects, calendar, priorities, and manual focus state
- Installable as a PWA
- Git-derived app version shown in the header

## How It Works Right Now

The app has 3 data layers:

1. `Connected upstream data`
- ClickUp assigned tasks sync into SQLite and power `ClickUp Tasks`
- Google Calendar powers the `Calendar` widget

2. `Local persistent dashboard state` — the system of record
- Stored in SQLite at `data/dashboard.sqlite` (or `OWNER_DASHBOARD_DB_PATH`)
- Shared across browsers/devices that hit the same running app
- Powers:
  - **`Clients` and `Projects` — real entities as of consolidation phase 2**,
    with full CRUD at `/clients` and `/projects`, statuses, rates, billing
    fields, and archive instead of delete. The dashboard widgets are a glance
    at them; the pages are the management surface. Imported once from
    mission-control (see below); no longer read from ClickUp lists
  - **`Time` — an owned entity as of consolidation phase 3**, with full CRUD
    at `/time`, hours-first entry, billable/non-billable status, a rate frozen
    at save, recent client/project prefill, and nullable legacy start/end times
  - `Time by Project`, now rolled up from local time entries rather than
    ClickUp time tracking
  - **`Expenses` and `Mileage` — owned entities as of phase 4**, with CRUD at
    `/expenses` and `/mileage`, receipt attachments, recurring-cost
    annualization, chart-of-accounts references, round-trip computation,
    recent-route reuse, and an editable reimbursement rate
  - `clickup_tasks` and `clickup_sync_state`, a local cache of assigned ClickUp
    tasks plus the last sync attempt/result
  - `Revenue`, with client MRR derived from active client rows and manual
    forecast fields kept in dashboard state
  - `Daily State`
  - `Next Steps`
  - `Phone Calls`
  - `Daily Note`
  - widget layout/order and which panels are collapsed
- Every save also writes a dated row to `daily_history`, which is what the
  `Streak` is counted from

Ticking a `ClickUp Tasks` checkbox writes the task's status back to ClickUp and
removes the task from the local cache after a successful close. ClickUp remains
the source of truth for task status.

3. `UI/runtime layer`
- Persistent sidebar menu (mission-control-style layout: Operate / Track /
  System / External sections) around every screen except `/login`; drawer +
  top bar under 860px. `/time`, `/expenses`, and `/mileage` are live;
  `/calendar` remains an honest phase 5 placeholder marked "soon";
  `/settings` manages the ClickUp API key, shows protection state and data
  locations, and links the consolidation scope at `/scope`
- Drag-and-drop widget ordering
- Collapsible panels, persisted server-side
- responsive top-aligned grid
- event detail modal for calendar items
- installable PWA shell with manifest, icons, and service worker

## Current Dashboard Model

The home dashboard is structured around the data the app owns and the connected
feeds it reads:

- `clients`: client list, active/prospect counts, payment type, rates, and
  client-derived MRR
- `projects`: active project list and priority quadrants from `urgent` and
  `important`
- `dashboard_state`: daily focus, blockers, next steps, revenue forecast,
  phone calls, daily note, layout, and collapsed panels
- `daily_history`: saved daily wins and the streak derived from those rows
- `time_entries`: owned hours, frozen billing-rate snapshots, billable status,
  and optional legacy start/end times
- `expenses`, `recurring_expenses`, `chart_accounts`, and
  `expense_category_accounts`: financial records plus the accounting reference
  data needed for later Schedule-C reporting
- `mileage_entries`: stored one-way and computed round-trip miles; the current
  reimbursement rate lives in `app_settings`
- `clickup_tasks`: cached assigned ClickUp tasks; refreshed when the cache is
  missing or more than one hour old
- External feeds: ClickUp assigned tasks and calendar events

The visible copy avoids framework descriptors and names the table or feed that
owns the data whenever that helps explain the screen.

## Access Control

Access is gated in `src/proxy.ts`. Three states:

| Configuration | Behavior |
| --- | --- |
| `OWNER_DASHBOARD_AUTH_TOKEN` set | Every page and API request needs the token, entered once at `/login` (stored in an httpOnly cookie) or sent as `Authorization: Bearer <token>`. |
| **nothing set (default)** | **The dashboard is locked.** Pages land on a setup screen, APIs answer 503, and no data is served or written. |
| `OWNER_DASHBOARD_ALLOW_UNPROTECTED=1`, no token | The old open behavior, chosen explicitly: anyone who can reach the address can read and edit everything, and the header shows an "Unprotected" chip. For a laptop, not for anything other machines can reach. |

Locked became the default in consolidation phase 1: this store holds MRR,
projections, goals, client contact details and rates. An unconfigured
deployment quietly serving all of that is the failure mode; now it cannot —
running open has to be said out loud.

**Current posture: said out loud.** The repo commits a `.env` with
`OWNER_DASHBOARD_ALLOW_UNPROTECTED=1`, by the owner's explicit choice: deploys
are `git pull` + restart with no login step, and the header wears the
"Unprotected" chip the whole time. A configured token always beats the
opt-out, so locking later is one step — set the token (below) or delete
`.env`.

To lock, set the variable and restart:

```bash
# in the project root; .env.local is gitignored
echo 'OWNER_DASHBOARD_AUTH_TOKEN=<a long random string you choose>' >> .env.local
```

The token is a shared secret you invent — nothing issues it. Generate one with
`openssl rand -base64 32`. Under systemd, put it in the unit
(`Environment="OWNER_DASHBOARD_AUTH_TOKEN=..."`) instead, since `.env.local` is
only picked up when the process runs from the project root. Under pm2, restart
with `--update-env`.

Scripted access once it is set:

```bash
curl -H "Authorization: Bearer $OWNER_DASHBOARD_AUTH_TOKEN" http://host:3018/api/state
```

`POST /api/login` exchanges the token for the session cookie; `DELETE /api/login`
clears it; `GET /api/login` reports `authConfigured` so the login page can show
setup instructions instead of a dead form. Verify the gate with
`curl -o /dev/null -w '%{http_code}' http://localhost:3018/api/state` —
401 means the token gate is on, 503 means locked-awaiting-setup, and 200
without credentials means the explicit opt-out is active.

## Current API Behavior

### `GET /api/state`
- Reads saved dashboard state from SQLite
- Returns `history`: the last 365 days of daily rows, oldest first
- Returns `streak`: consecutive days ending today with a daily win recorded
- Also returns `authConfigured`, which drives the header's "Unprotected" chip
- Gated per Access Control: token required when set, 503 when locked, open only
  under the explicit opt-out

### `PUT /api/state`
- Saves dashboard state back to SQLite
- Also writes (or rewrites) today's `daily_history` row, in the same transaction
- The first save of each local day snapshots the database to `backups/` first
- Gated the same way as the GET

### `GET /api/clients` · `POST /api/clients` · `GET|PUT|DELETE /api/clients/{id}`
- The Clients entity: list (`?includeArchived=1` to include archived), create,
  read, update. DELETE archives — hard deletion does not exist, because time
  entries, expenses, and mileage records hang off these rows
- Validation errors return 400 with a message; unknown ids 404

### `GET /api/projects` · `POST /api/projects` · `GET|PUT|DELETE /api/projects/{id}`
- Same shape as clients. A project may belong to a client (`clientId`) or be
  unassigned; carries `hourlyRateOverride` (beats the client rate),
  `status` (`active | on_hold | completed`), and the `urgent`/`important`
  Eisenhower axes for phase 6

### `GET /api/time-entries` · `POST /api/time-entries` · `GET|PUT|DELETE /api/time-entries/{id}`
- Lists (optional `from`, `to`, and capped `limit` query parameters), creates,
  reads, updates, and deletes time entries
- A project inherits its client when one is not supplied; mismatched
  client/project ownership is rejected
- Native saves resolve `project.hourlyRateOverride → client.hourlyRate → 0`
  and freeze that number on the row. Editing hours/details keeps the snapshot;
  changing the client/project resolves a new one
- List responses include `recentDefaults`, used by `/time` to prefill the
  last-used client, project, and billable choice

### `GET /api/expenses` · `POST /api/expenses` · `GET|PUT|DELETE /api/expenses/{id}`
- Full financial-record CRUD with client/project validation, expense versus
  income classification, company/vendor fields, billable and reimbursable
  flags, accounting codes, recurring frequency, and annualized amount
- `GET|POST /api/expenses/recurring` and
  `GET|PUT|DELETE /api/expenses/recurring/{id}` manage recurring definitions
- `GET|POST|DELETE /api/expenses/{id}/receipt` serves and manages PDF/JPEG/PNG/
  WebP receipts up to 10 MB, stored beside the SQLite database

### `GET /api/mileage` · `POST /api/mileage` · `GET|PUT|DELETE /api/mileage/{id}`
- Full trip CRUD. `totalMiles` is always recomputed as
  `roundTrip ? miles × 2 : miles`; callers cannot override it
- Returns unique recent routes for quick prefill and reimbursement totals at
  the rate managed by `GET|PUT /api/mileage/settings`

### `POST /api/admin/import-mission-control`
- Body: `{ "sourcePath": "/path/to/AMB-mission-control.db" }` — a file already
  on the server
- Imports clients, projects, time, accounting references, recurring expenses,
  financial records, mileage, and the mileage-rate setting with the cleaning rules from the scope doc
  (status normalization, 0-means-unset money fields, soft-deleted projects
  skipped, dangling links imported unassigned, invalid time durations skipped,
  the known `10:30` date repaired, Revenue rows classified as income, and
  mileage totals recomputed), each fix-up reported in `warnings`
- **Idempotent**: every imported row keeps its mission-control id in `mcId`,
  and re-running upserts by it — a fresher MC copy converges instead of
  duplicating
- Refuses to run (403) unless a real auth token is configured, on top of the
  normal gate: an open deployment must not expose an endpoint that reads
  server-side files

### `GET /api/dashboard`
- If `OWNER_DASHBOARD_DATA_URL` is set, proxies that upstream endpoint
- Otherwise reads `ClickUp Tasks` from the local `clickup_tasks` cache. If the
  last successful sync is missing or more than one hour old, it attempts a
  fresh ClickUp fetch first and stores the result in SQLite. The ClickUp API key
  is read from the Settings screen first, then `CLICKUP_API_KEY`, then the
  legacy `~/.openclaw/secrets.json` file
- If a refresh fails but a previous cache exists, the dashboard serves the
  cached tasks and shows the sync error with the last successful sync time. If
  there is no cached ClickUp data yet, it falls back to sample task data and
  reports why
- `Time by Project` always comes from local `time_entries`, including when task
  data is proxied or falls back. The old Projects/Clients/time ClickUp fetches
  are gone as of phases 2–3
- Proxied and live payloads are both normalized, so a drifting upstream cannot crash the page
- `ClickUp Tasks` is currently ranked against the saved `lens`, `target`, and
  `bottleneck`, with due date and priority still influencing ranking

### `PATCH /api/tasks/{taskId}`
- Body: `{ "done": boolean, "listId": string }`
- Writes a `ClickUp Tasks` checkbox back to ClickUp as a task status change
- On a successful done write, deletes the task from `clickup_tasks` so the local
  dashboard reflects the closed task before the next scheduled sync
- Status names are per-list, so the list's own statuses are read first and a
  status of type `closed`/`done` (or `open` when unchecking) is chosen. If the
  list has none, the request fails with 422 and the task is left untouched
  rather than being moved to a guessed status
- Never falls back to a no-op: a write that quietly does nothing would leave the
  checkbox claiming a task is closed while ClickUp still has it open

### `GET /api/calendar`
- If `OWNER_DASHBOARD_CALENDAR_URL` is set, proxies that upstream endpoint
- Otherwise pulls live Google Calendar data through local `gog` (`~/.local/bin/gog`)
- Falls back to local/sample data only if live fetch fails, reporting `fallbackReason` the same way

## Current Persistence

### SQLite

Database file:

```text
data/dashboard.sqlite
```

Currently stores:

- manual dashboard state
- hyperfocus / system fields
- goals
- phone calls
- widget layout/order and collapsed panels
- one dated snapshot per day, in `daily_history`
- clients, projects, and time entries
- cached ClickUp assigned tasks and sync metadata
- `app_settings`, including the Settings-managed ClickUp API key

ClickUp tasks are stored as a refreshable cache, not as source-of-truth data.
Google Calendar events are not stored in SQLite right now.

### Daily history

`dashboard_state` is a single row (`id = 1`), so before `daily_history` existed
every save overwrote the day before it and nothing about yesterday survived.
That is why the streak used to be a number typed in by hand — there was no
record to count.

Each save upserts today's row, so the row settles on wherever the day ended up
and earlier days are never touched again. A row keeps the daily win, lens,
target, bottleneck, MRR figures, goals, what's important, and the phone-call
counts.

The `Streak` in Daily State is derived from those rows: consecutive days with a
**non-empty daily win**, counting back from today. A blank day breaks it. Today
being blank does not — counting starts at yesterday in that case, so the streak
does not read as broken every morning before the win is filled in. Typing a win
updates the number immediately rather than waiting out the save debounce.

Upgrading an existing database needs no manual step: opening it runs any
pending migrations, and history simply starts from the first save after the
upgrade.

### First-boot seed

A fresh database comes up already holding the clients and projects imported
from mission-control (`src/lib/entity-seed.ts`, generated from the verified
2026-08-13 import). The seed fires only when both tables are empty — any
existing row, seeded or hand-made, disables it forever, so nothing the owner
edits is ever overwritten. Rows keep `mc_id`, so running the real
mission-control import later converges onto them rather than duplicating.
Time, expense, recurring, accounting, and mileage rows are not committed as
seed data. This checkout's local database was loaded with 98 time rows, 708
financial rows, 13 recurring definitions, 30 chart accounts, 24 category
mappings, and 4 mileage rows on 2026-08-13; a separately deployed database must
run the same import against the verified mission-control file.
This is deliberate: deploys need zero setup and no database hand-off. Delete
the file and its call in `dashboard-state.ts` once seeding has outlived its
usefulness.

### Migrations

Schema changes go through `src/lib/migrations.ts` (consolidation phase 1):
an ordered list of one-shot migrations, each applied inside a transaction and
recorded in `schema_migrations`, so a database always knows what has been
applied to it and a failure rolls back cleanly instead of leaving the schema
half-changed.

The first entry, `001-baseline`, is deliberately idempotent (IF NOT EXISTS
plus a conditional column add) because it adopts live databases created across
three earlier schema generations. It is the only migration allowed that shape —
everything after it runs against a known state and must be a plain, run-once
migration.

### Location and backups

The database lives at `data/dashboard.sqlite` under the working directory, or
wherever `OWNER_DASHBOARD_DB_PATH` points. The first save of each local day
snapshots the database (SQLite `VACUUM INTO`) to a `backups/` directory next to
it — taken *before* that save applies, so day N's snapshot is the state as day
N-1 left it. The newest 14 snapshots are kept. A backup failure is logged
loudly but never blocks the save. Restoring is: stop the server, copy the
snapshot over `dashboard.sqlite`, start.

## Versioning

- Base release line is currently `v0.1`
- The header version is derived from git:
  - current base commit shows `v0.1`
  - each newer commit becomes `v0.1.<n>+<sha>`
  - uncommitted local changes append `.dev`
- This means the visible version changes automatically as soon as a new commit exists in the deployed checkout

## PWA

The app now includes:

- `manifest.webmanifest`
- install icons, including maskable icon
- Apple web app metadata
- service worker registration
- `public/sw.js` for basic shell/API caching

This means the dashboard can be installed and reopened more like an app.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. It runs open (the committed `.env` opts out of
the lock — see Access Control) and comes up with the seeded clients and
projects. To develop against the locked flow instead, set a token in
`.env.local`:

```bash
echo "OWNER_DASHBOARD_AUTH_TOKEN=$(openssl rand -base64 32)" >> .env.local
```

Node >= 22.5 is required — `src/lib/dashboard-state.ts` uses `node:sqlite`.

### Keeping Next patched

`next` is pinned exactly rather than floated on a range, so security releases do
not arrive on their own. That matters more here than in most apps: `src/proxy.ts`
is the whole access-control story, and several Next advisories have been
proxy/middleware bypasses. Check `npm audit` periodically and treat a
proxy-bypass advisory as worth acting on immediately, even on a tailnet.

After any Next upgrade, re-check the gate rather than assuming it survived —
with a token set, every `/api/*` route must answer 401 without credentials, and
page requests must land on `/login`.

## Branches

Two long-lived branches, plus short feature branches:

| Branch | Role |
| --- | --- |
| `preview` | Integration. Every change lands here first, as its own small pull request. |
| `stable` | Release — what the live host runs. Only ever advanced by a "promote preview to stable" merge, so its tree is always a tree that has sat on `preview`. |
| `feature/*`, `redesign/*`, `chore/*` | Short-lived, one per reviewable change, merged into `preview` and deleted. |

The rule that keeps this honest: **nothing reaches `stable` except by promoting
`preview`.** A promotion is therefore a no-op diff — if promoting ever shows
file changes, something was committed to `stable` directly and the two have
diverged.

Work in ordered, small pull requests rather than one long-lived branch; the
redesign track (`redesign/01-query-contracts` … `06-maps-adapter`) is the
worked example, and
[`docs/transaction-ledgers-redesign-plan.md`](docs/transaction-ledgers-redesign-plan.md)
records the reasoning.

`main` is **retired**. It stopped at `46a0ee9`, holds nothing the other two
lack, and is kept only so old links resolve. Do not branch from it or merge
into it.

## Checks

```bash
npm run typecheck
npm run lint
npm test          # npm run test:watch while iterating
npm run build
```

`.github/workflows/ci.yml` runs all four on every pull request and on every
push to `preview` and `stable`.

Tests live next to what they cover (`src/lib/*.test.ts`) and are aimed at the
bugs that actually shipped rather than at coverage for its own sake:

- `calendar-days.test.ts` — day grouping across seven timezones. The suite sets
  `TZ` per case, so it exercises `America/New_York`, `Europe/Berlin` and friends
  even though CI runs in UTC. This matters: the original UTC-based grouping bug
  is invisible when tested only in UTC.
- `dashboard-data.test.ts` — payload normalization against malformed upstream
  responses, including the exact body that used to white-screen the dashboard.
- `auth.test.ts` — the access-control decision matrix, in both directions: with
  a token set, any case starting to allow a request without credentials is a
  data leak; with nothing set, any case starting to allow one is the locked
  default silently reverting to open.
- `dashboard-layout.test.ts` — the collapsible-panel id set.
- `dashboard-save.test.ts` — the autosave decision, in both directions.
- `clickup.test.ts` — status selection for the write-back, weighted toward the
  refusal cases, since guessing a status would move a real task.
- `entities.test.ts` — Clients/Projects CRUD against real SQLite: archive
  never deletes, a project cannot point at a missing client, and rate
  resolution (override → client → 0, with 0 treated as unset).
- `mission-control-import.test.ts` — the import against a synthetic MC
  database replicating the live file's dirty data: three status spellings, a
  soft-deleted project, a dangling client link, a nameless row. Idempotence is
  the property under test — a second run must converge, not duplicate.
- `history.test.ts` — streak counting and day-key arithmetic, again across
  several timezones. Includes the DST transitions where midnight does not exist
  (`America/Santiago`, `Asia/Beirut`), because a day-shift anchored at midnight
  silently lands on the wrong day there.
- `dashboard-history.test.ts` — the `daily_history` table against real SQLite:
  the upsert, the JSON and integer columns, the lookback window. A streak
  counted off rows that did not round-trip is wrong in a way that testing the
  pure counting rules cannot catch.
- `dashboard-history-upgrade.test.ts` — reading and saving against a database
  written by the pre-history schema, which now also proves the migration runner
  adopts a legacy file: baseline applied and recorded, old rows intact. The
  live dashboard's SQLite file predates all of this, so "works on a fresh
  database" proves nothing about the only database that matters.
- `migrations.test.ts` — the runner itself, weighted toward failure: a failing
  migration must roll back entirely and stay unrecorded, and the ones after it
  must not run.
- `backup.test.ts` — the daily snapshot round-trips through real SQLite and the
  prune never deletes a file it does not recognise.

The database suites point `OWNER_DASHBOARD_DB_PATH` at a temp directory before
importing `dashboard-state.ts`, so `npm test` never touches the real
`data/dashboard.sqlite`.

## Production / Current Live Host

The current Tailscale-served instance has been run on:

```text
http://100.119.59.63:3018
http://amb-ubuntu-01.tail7a2140.ts.net:3018
```

### Outbound links in the header

The header links out to two other tools on the same tailnet:

| Button | Target |
| --- | --- |
| `Tasks` | `http://100.119.59.63:3333/tasks` |
| `Hermes` | `http://100.82.222.18:9119/chat` (Hermes Dashboard) |

Both addresses are hardcoded, so both are dead links from anywhere off the
tailnet. That is fine while this is a single-owner dashboard on one machine and
is marked `FIXME` in the component; they should move to env alongside the
ClickUp source ids when it stops being one.

## Key Files

- `src/components/owner-dashboard.tsx`
- `src/components/owner-dashboard.module.css`
- `src/app/api/dashboard/route.ts`
- `src/app/api/calendar/route.ts`
- `src/app/api/state/route.ts`
- `src/app/api/login/route.ts`
- `src/app/error.tsx`
- `src/proxy.ts`
- `src/lib/auth.ts`
- `src/app/api/tasks/[taskId]/route.ts`
- `src/lib/calendar-days.ts`
- `src/lib/clickup.ts`
- `src/lib/clickup-task-cache.ts`
- `src/lib/dashboard-data.ts`
- `src/lib/dashboard-layout.ts`
- `src/components/app-shell.tsx`
- `src/app/(app)/layout.tsx`
- `src/app/(app)/clients/page.tsx`
- `src/app/(app)/projects/page.tsx`
- `src/app/(app)/time/page.tsx`
- `src/app/(app)/expenses/page.tsx`
- `src/app/(app)/mileage/page.tsx`
- `src/app/(app)/settings/page.tsx`
- `src/app/api/clients/route.ts`
- `src/app/api/projects/route.ts`
- `src/app/api/time-entries/route.ts`
- `src/app/api/expenses/route.ts`
- `src/app/api/mileage/route.ts`
- `src/app/api/admin/import-mission-control/route.ts`
- `src/lib/backup.ts`
- `src/lib/dashboard-state.ts`
- `src/lib/entities.ts`
- `src/lib/fallback.ts`
- `src/lib/history.ts`
- `src/lib/migrations.ts`
- `src/lib/mission-control-import.ts`
- `src/lib/sample-data.ts`
- `src/lib/schema.ts`
- `src/lib/time-entries.ts`
- `src/lib/expenses.ts`
- `src/lib/mileage.ts`
- `src/lib/types.ts`

## What Still Needs Improvement

Known and deliberate, roughly in the order they are worth fixing:

- **Calendar still only runs on one machine.** ClickUp credentials now live in
  Settings, with env/OpenClaw as fallback. Calendar still shells out to
  `~/.local/bin/gog`, so it remains tied to the machine where that account is
  configured.
- Mileage entry currently accepts addresses and manual miles. Maps
  autocomplete and automatic distance calculation remain a later integration;
  recent-route prefill covers repeated trips without requiring a Maps key.
- The imported source has no account mapping for 584 records (mostly the broad
  `Operating Expenses` category). They remain lossless with an unset account
  code and must be categorized before Schedule-C reports can be authoritative.
- **`ClickUp Tasks` ranking is heuristic, and its lens weighting does not work.** In
  `scoreTaskAgainstBottleneck`, lens matches are meant to score 2 against 4 for
  everything else, but a single token is compared against the whole `lens`
  field, so any multi-word lens never matches and every hit scores 4. Left
  alone on purpose: worth one considered pass over the whole ranking rather than
  a drive-by fix. Marked `FIXME` in `src/app/api/dashboard/route.ts`.
- **ClickUp source IDs are hardcoded.** The team and assignee IDs still read env
  with hardcoded fallbacks. They should be env-only, and in `.env.example`,
  when this stops being single-tenant.
- The header's "Tasks" and "Hermes" buttons link to hardcoded Tailscale
  addresses (`http://100.119.59.63:3333/tasks` and
  `http://100.82.222.18:9119/chat`), which are dead links from anywhere off the
  tailnet. Marked `FIXME`; see [Outbound links in the header](#outbound-links-in-the-header).
- History is recorded but barely used — only the streak reads it. The rows carry
  MRR, goals, and call counts, so trend and look-back reporting is now possible
  without further schema work.
- Service worker caching is intentionally light.
- Install UX is still basic; no explicit install button yet.
- Tests cover the lib and database layers; the React components are untested.
  `owner-dashboard.tsx` is ~1,400 lines and holds the save orchestration,
  drag-and-drop, and the ClickUp write-back — which is where the shipped bugs
  were. Extracting the fetch/save orchestration into a hook would make it
  testable and shrink the file at the same time.
- The dashboard currently runs open — but explicitly, not by accident: the
  committed `.env` opts out of phase 1's locked-by-default, per the owner's
  call, and the header chip shows it. Setting a token (which always wins over
  the opt-out) is the single step to lock it when client data on the tailnet
  starts feeling heavier than the login ceremony.
