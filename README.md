# Marketing Bull Owner Dashboard

Standalone daily owner dashboard for Alex.

## What it is

- Lightweight Next.js app with a single dashboard screen
- Manual widgets persisted in browser storage
- Small adapter routes for calendar and dashboard data
- No Mission Control shell, routing noise, or unrelated agent features

## Current data sources

- `GET /api/calendar`
  - If `OWNER_DASHBOARD_CALENDAR_URL` is set, proxies that upstream endpoint
  - Expects a Mission Control-style payload with `upcomingEvents`
  - Falls back to sample events if unset
- `GET /api/dashboard`
  - If `OWNER_DASHBOARD_DATA_URL` is set, proxies that upstream endpoint
  - Otherwise returns local mock data for projects, hours, and up-next

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Next integration steps

1. Replace `/api/dashboard` mock data with ClickUp API reads.
2. Point `OWNER_DASHBOARD_CALENDAR_URL` at a lightweight calendar service, or replace `/api/calendar` with direct Google Calendar integration.
3. Add ClickUp write-back for the Up Next checkboxes.
