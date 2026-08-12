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

Access is gated in `src/proxy.ts`, but only when a token is configured:

| `OWNER_DASHBOARD_AUTH_TOKEN` | Behavior |
| --- | --- |
| **unset (default)** | **The dashboard is open — anyone who can reach the address can read and edit it.** The header shows an "Unprotected" chip so this is visible rather than silent. |
| set | Every page and API request needs the token, entered once at `/login` (stored in an httpOnly cookie) or sent as `Authorization: Bearer <token>`. |

Unset is the default so the app runs with no configuration. That is fine on a
laptop. It is not fine on anything reachable by other machines: this screen
holds MRR, projections, goals, and client phone numbers, and `/api/state`
accepts writes as well as reads.

To protect it, set the variable and restart:

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
clears it. Verify the gate is live with `curl -o /dev/null -w '%{http_code}'
http://localhost:3018/api/state` — 401 means it is on.

## Current API Behavior

### `GET /api/state`
- Reads saved dashboard state from SQLite
- Returns `history`: the last 365 days of daily rows, oldest first
- Returns `streak`: consecutive days ending today with a daily win recorded
- Also returns `authConfigured`, which drives the header's "Unprotected" chip
- Requires auth only when a token is configured (see Access Control)

### `PUT /api/state`
- Saves dashboard state back to SQLite
- Also writes (or rewrites) today's `daily_history` row, in the same transaction
- Requires auth only when a token is configured (see Access Control)

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

Upgrading an existing database needs no manual step: `CREATE TABLE IF NOT
EXISTS` covers a new table (unlike a new *column*, which is what
`applyMigrations()` is for), and history simply starts from the first save after
the upgrade.

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

Open `http://localhost:3000`. No token is needed — the dashboard is open by
default. Copy `.env.example` to `.env.local` and set
`OWNER_DASHBOARD_AUTH_TOKEN` before exposing it to anything beyond your own
machine.

Node >= 22.5 is required — `src/lib/dashboard-state.ts` uses `node:sqlite`.

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
- `auth.test.ts` — the access-control decision matrix. With a token set, any
  case starting to allow a request without credentials is a data leak.
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
  written by the pre-history schema. The live dashboard's SQLite file predates
  all of this, so "works on a fresh database" proves nothing about the only
  database that matters.

The two database suites `chdir` into a temp directory before importing
`dashboard-state.ts`, since it resolves its path from cwd at module load. Vitest
forks each test file into its own process, so that cannot reach another suite —
and it means `npm test` never touches the real `data/dashboard.sqlite`.

## Production / Current Live Host

The current Tailscale-served instance has been run on:

```text
http://100.119.59.63:3018
http://amb-ubuntu-01.tail7a2140.ts.net:3018
```

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
- `src/lib/dashboard-state.ts`
- `src/lib/fallback.ts`
- `src/lib/history.ts`
- `src/lib/sample-data.ts`
- `src/lib/types.ts`

## What Still Needs Improvement

Known and deliberate, roughly in the order they are worth fixing:

- **The app only runs on one machine.** The ClickUp key is read from
  `~/.openclaw/secrets.json`, the calendar shells out to `~/.local/bin/gog`, and
  SQLite lives at `cwd()/data` with no backup. Reading `CLICKUP_API_KEY` from
  env (falling back to the secrets file) and making the database path
  configurable is the smallest change that unblocks running this anywhere else —
  and would let the database tests drop their `chdir`.
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
- The header's "Tasks" button links to a hardcoded Tailscale address
  (`http://100.119.59.63:3333/tasks`), which is a dead link from anywhere else.
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
- The dashboard ships unprotected by default; `OWNER_DASHBOARD_AUTH_TOKEN` has
  to be set deliberately before exposing it beyond localhost.
