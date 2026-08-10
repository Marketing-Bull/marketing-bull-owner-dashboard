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

## Current API Behavior

### `GET /api/state`
- Reads saved dashboard state from SQLite

### `PUT /api/state`
- Saves dashboard state back to SQLite

### `GET /api/dashboard`
- If `OWNER_DASHBOARD_DATA_URL` is set, proxies that upstream endpoint
- Otherwise fetches live ClickUp data directly
- Falls back to sample data only if live fetch fails
- `Up Next` is currently ranked against the saved `lens`, `target`, and `bottleneck`, with due date and priority still influencing ranking

### `GET /api/calendar`
- If `OWNER_DASHBOARD_CALENDAR_URL` is set, proxies that upstream endpoint
- Otherwise pulls live Google Calendar data through local `gog`
- Falls back to local/sample data only if live fetch fails

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

Open `http://localhost:3000`.

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
- `src/lib/dashboard-state.ts`
- `src/lib/sample-data.ts`
- `src/lib/types.ts`

## What Still Needs Improvement

- `Up Next` ranking is better, but still heuristic-driven
- no ClickUp write-back yet
- no deeper history/streak reporting yet
- service worker caching is intentionally light
- install UX is still basic; no explicit install button yet
