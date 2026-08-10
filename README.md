# Marketing Bull Owner Dashboard

Standalone daily owner dashboard for Alex.

## What It Is

- Lightweight Next.js app with one main dashboard screen
- Built as a standalone replacement for the heavier Mission Control route
- Designed as a compact daily command center for projects, calendar, priorities, and manual focus state
- Installable as a PWA

## How It Works Right Now

The app has 3 data layers:

1. `Live external data`
- ClickUp powers `Projects`, `Up Next`, and `Hours by Project`
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
  - widget layout/order

3. `UI/runtime layer`
- Drag-and-drop widget ordering
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

The dashboard holds MRR, projections, goals, and client phone numbers, and
`/api/state` both reads and writes them. Access is gated in `src/proxy.ts`:

| `OWNER_DASHBOARD_AUTH_TOKEN` | Behavior |
| --- | --- |
| unset | Only requests whose `Host` is `localhost` / `127.0.0.1` / `[::1]` are served. Everything else gets 401. |
| set | Every page and API request needs the token, entered once at `/login` (stored in an httpOnly cookie) or sent as `Authorization: Bearer <token>`. |

Scripted access:

```bash
curl -H "Authorization: Bearer $OWNER_DASHBOARD_AUTH_TOKEN" http://host:3018/api/state
```

`POST /api/login` exchanges the token for the session cookie; `DELETE /api/login`
clears it.

> **Heads up for the Tailscale host below:** it is reached by IP/MagicDNS name,
> not `localhost`, so it now returns 401 until `OWNER_DASHBOARD_AUTH_TOKEN` is
> set in that environment. Set it before the next deploy.

The `Host` check backing the token-free local mode is a guard against accidental
exposure, not against a determined attacker — `Host` can be forged. Set the token
for anything beyond your own machine.

## Current API Behavior

### `GET /api/state`
- Reads saved dashboard state from SQLite
- Requires auth (see Access Control)

### `PUT /api/state`
- Saves dashboard state back to SQLite
- Requires auth (see Access Control)

### `GET /api/dashboard`
- If `OWNER_DASHBOARD_DATA_URL` is set, proxies that upstream endpoint
- Otherwise fetches live ClickUp data directly (API key read from `~/.openclaw/secrets.json` → `env.CLICKUP_API_KEY`)
- Falls back to sample data only if live fetch fails, and always reports why: the failure is logged server-side and returned as `fallbackReason`, which the UI shows as a "these numbers are not real" banner
- Proxied and live payloads are both normalized, so a drifting upstream cannot crash the page
- `Up Next` is currently ranked against the saved `lens`, `target`, and `bottleneck`, with due date and priority still influencing ranking

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
- widget layout/order

It does **not** store ClickUp tasks or Google Calendar events as source-of-truth data right now.

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

Open `http://localhost:3000`. No token is needed on localhost; copy
`.env.example` to `.env.local` and set `OWNER_DASHBOARD_AUTH_TOKEN` when you want
to reach the dashboard from another device.

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
- `auth.test.ts` — the access-control decision matrix, weighted toward the
  fail-open cases where a mistake would leak data.

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
- `src/lib/dashboard-data.ts`
- `src/lib/dashboard-state.ts`
- `src/lib/fallback.ts`
- `src/lib/sample-data.ts`
- `src/lib/types.ts`

## What Still Needs Improvement

- `Up Next` ranking is better, but still heuristic-driven
- no ClickUp write-back yet; `Up Next` checkboxes still reset on refresh
- no deeper history/streak reporting yet
- service worker caching is intentionally light
- install UX is still basic; no explicit install button yet
- ClickUp team/assignee IDs and the calendar account are hardcoded as source
  defaults; they should be env-only
- `saveDashboardState` updates `dashboard_state` outside the transaction that
  wraps the phone-call rows, so a failure mid-save can leave a partial write
- tests cover the lib layer only; the React components are untested
