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
- `Multiply`: repeat the daily win and track consistency

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
- Also returns `authConfigured`, which drives the header's "Unprotected" chip
- Requires auth only when a token is configured (see Access Control)

### `PUT /api/state`
- Saves dashboard state back to SQLite
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

It does **not** store ClickUp tasks or Google Calendar events as source-of-truth data right now.

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
- `src/lib/dashboard-state.ts`
- `src/lib/fallback.ts`
- `src/lib/sample-data.ts`
- `src/lib/types.ts`

## What Still Needs Improvement

- `Up Next` ranking is better, but still heuristic-driven
- no deeper history/streak reporting yet
- service worker caching is intentionally light
- install UX is still basic; no explicit install button yet
- ClickUp team/assignee IDs and the calendar account are hardcoded as source
  defaults; they should be env-only
- the header's `Tasks` and `Hermes` links are hardcoded Tailscale addresses, so
  they are dead links from anywhere off the tailnet
- tests cover the lib layer only; the React components are untested
- the dashboard ships unprotected by default; `OWNER_DASHBOARD_AUTH_TOKEN` has
  to be set deliberately before exposing it beyond localhost
