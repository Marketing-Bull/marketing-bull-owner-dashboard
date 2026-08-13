# Marketing Bull Owner Dashboard

Standalone daily owner dashboard for Alex.

## What It Is

- Lightweight Next.js app with one main dashboard screen
- Built as a standalone replacement for the heavier Mission Control route
- Designed as a compact daily command center for projects, calendar, priorities, and manual focus state
- Installable as a PWA
- Git-derived app version shown in the header

## How It Works Right Now

The app has 3 data layers:

1. `Live external data`
- ClickUp powers `Eisenhower Matrix`, `Projects`, `Clients`, `Up Next`, and `Hours by Project`
- Google Calendar powers the `Calendar` widget

2. `Local persistent dashboard state`
- Stored in SQLite at `data/dashboard.sqlite`
- Shared across browsers/devices that hit the same running app
- Powers:
  - `MRR`
  - `Hyperfocus` / 4-step system fields
  - `Goals`
  - `Phone Calls`
  - `What's Important`
  - widget layout/order and which panels are collapsed
- Every save also writes a dated row to `daily_history`, which is what the
  `Streak` is counted from

Ticking an `Up Next` checkbox writes the task's status back to ClickUp, so the
change lives in ClickUp rather than in the page.

3. `UI/runtime layer`
- Drag-and-drop widget ordering
- Collapsible panels (including the Daily Hyperfocus System), persisted server-side
- responsive top-aligned grid
- event detail modal for calendar items
- installable PWA shell with manifest, icons, and service worker

## Current Dashboard Model

The page is structured around the 4-step daily operating system:

- `Subtract`: remove distractions and friction
- `Add`: set lens, target, why, and bottleneck
- `Divide`: split work into morning / midday / afternoon lanes
- `Multiply`: repeat the daily win, with the streak counted from saved history

This sits above the operational widgets so the dashboard is not just a reporting screen; it is meant to drive the day.

## Access Control

Access is gated in `src/proxy.ts`. Three states:

| Configuration | Behavior |
| --- | --- |
| `OWNER_DASHBOARD_AUTH_TOKEN` set | Every page and API request needs the token, entered once at `/login` (stored in an httpOnly cookie) or sent as `Authorization: Bearer <token>`. |
| **nothing set (default)** | **The dashboard is locked.** Pages land on a setup screen, APIs answer 503, and no data is served or written. |
| `OWNER_DASHBOARD_ALLOW_UNPROTECTED=1`, no token | The old open behavior, chosen explicitly: anyone who can reach the address can read and edit everything, and the header shows an "Unprotected" chip. For a laptop, not for anything other machines can reach. |

Locked became the default in consolidation phase 1: this store holds MRR,
projections, goals, and client phone numbers today, and is about to hold client
rates and financial entries. An unconfigured deployment quietly serving all of
that is the failure mode; now it cannot.

To unlock, set the variable and restart:

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

### `GET /api/dashboard`
- If `OWNER_DASHBOARD_DATA_URL` is set, proxies that upstream endpoint
- Otherwise fetches live ClickUp data directly (API key read from `~/.openclaw/secrets.json` → `env.CLICKUP_API_KEY`)
- The default ClickUp sources are:
  - `Eisenhower Matrix`: team-wide assigned tasks ranked into P0-P3 buckets
  - `Projects`: list `901114301312`
  - `Clients`: list `901112740853`, filtered to `Won`
- Falls back to sample data only if live fetch fails, and always reports why: the failure is logged server-side and returned as `fallbackReason`, which the UI shows as a "these numbers are not real" banner
- Proxied and live payloads are both normalized, so a drifting upstream cannot crash the page
- `Up Next` is currently ranked against the saved `lens`, `target`, and `bottleneck`, with due date and priority still influencing ranking

### `PATCH /api/tasks/{taskId}`
- Body: `{ "done": boolean, "listId": string }`
- Writes an `Up Next` checkbox back to ClickUp as a task status change
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

It does **not** store ClickUp tasks or Google Calendar events as source-of-truth data right now.

### Daily history

`dashboard_state` is a single row (`id = 1`), so before `daily_history` existed
every save overwrote the day before it and nothing about yesterday survived.
That is why the streak used to be a number typed in by hand — there was no
record to count.

Each save upserts today's row, so the row settles on wherever the day ended up
and earlier days are never touched again. A row keeps the daily win, lens,
target, bottleneck, MRR figures, goals, what's important, and the phone-call
counts.

The `Streak` on the Multiply step is derived from those rows: consecutive days
with a **non-empty daily win**, counting back from today. A blank day breaks it.
Today being blank does not — counting starts at yesterday in that case, so the
streak does not read as broken every morning before the win is filled in. Typing
a win updates the number immediately rather than waiting out the save debounce.

Upgrading an existing database needs no manual step: opening it runs any
pending migrations, and history simply starts from the first save after the
upgrade.

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
# pick one: run open on this machine only…
echo 'OWNER_DASHBOARD_ALLOW_UNPROTECTED=1' >> .env.local
# …or set a real token
echo "OWNER_DASHBOARD_AUTH_TOKEN=$(openssl rand -base64 32)" >> .env.local
npm run dev
```

Open `http://localhost:3000`. With neither variable set the dashboard is
locked and shows setup instructions instead of data — that is the default
doing its job, not a bug.

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

## Checks

```bash
npm run typecheck
npm run lint
npm test          # npm run test:watch while iterating
npm run build
```

`.github/workflows/ci.yml` runs all four on every push to `main` and every pull
request.

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
- `src/lib/dashboard-data.ts`
- `src/lib/dashboard-layout.ts`
- `src/lib/backup.ts`
- `src/lib/dashboard-state.ts`
- `src/lib/fallback.ts`
- `src/lib/history.ts`
- `src/lib/migrations.ts`
- `src/lib/sample-data.ts`
- `src/lib/types.ts`

## What Still Needs Improvement

Known and deliberate, roughly in the order they are worth fixing:

- **The live integrations only run on one machine.** The ClickUp key is read
  from `~/.openclaw/secrets.json` and the calendar shells out to
  `~/.local/bin/gog`. Reading `CLICKUP_API_KEY` from env (falling back to the
  secrets file) is the smallest remaining change — the database side is solved
  (`OWNER_DASHBOARD_DB_PATH`, daily backups, migration runner).
- **`Up Next` ranking is heuristic, and its lens weighting does not work.** In
  `scoreTaskAgainstBottleneck`, lens matches are meant to score 2 against 4 for
  everything else, but a single token is compared against the whole `lens`
  field, so any multi-word lens never matches and every hit scores 4. Left
  alone on purpose: worth one considered pass over the whole ranking rather than
  a drive-by fix. Marked `FIXME` in `src/app/api/dashboard/route.ts`.
- **ClickUp source IDs are hardcoded.** The projects and clients list IDs are
  now named outright in `src/app/api/dashboard/route.ts` rather than read from
  undocumented env vars; the team and assignee IDs still read env with hardcoded
  fallbacks. All four should be env-only, and in `.env.example`, when this stops
  being single-tenant. Marked `FIXME`.
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
- ~~The dashboard ships unprotected by default~~ — fixed in consolidation
  phase 1: unset now means locked, and running open requires the explicit
  `OWNER_DASHBOARD_ALLOW_UNPROTECTED=1`. The live host still needs a real
  token set at deploy time.
