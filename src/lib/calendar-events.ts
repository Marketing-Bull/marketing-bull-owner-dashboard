/**
 * Google Calendar (`gog`) payload -> `CalendarEvent` mapping.
 *
 * Extracted from the route handler so it is importable by tests: Next route
 * files are limited to their own conventional exports, and the all-day date
 * handling here is exactly the kind of thing that silently shifts a day.
 */

import type { CalendarEvent } from "@/lib/types";

export type GogEvent = {
  id?: string;
  summary?: string;
  htmlLink?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

const DEFAULT_EVENT_MINUTES = 30;

export function parseEventDate(value?: { dateTime?: string; date?: string }): number {
  if (!value) return 0;
  if (value.dateTime) return new Date(value.dateTime).getTime();

  if (value.date) {
    // An all-day "2026-08-10" parses as UTC midnight via the Date constructor,
    // which is the previous local day west of UTC. Build it as local midnight
    // so it groups under the day Google actually means.
    const [year, month, day] = value.date.split("-").map(Number);
    if ([year, month, day].every((part) => Number.isFinite(part))) {
      return new Date(year, month - 1, day).getTime();
    }
    return new Date(value.date).getTime();
  }

  return 0;
}

export function normalizeGogEvents(items: GogEvent[]): CalendarEvent[] {
  return items
    .map((event) => {
      const startMs = parseEventDate(event.start);
      const endMs = parseEventDate(event.end) || startMs + DEFAULT_EVENT_MINUTES * 60 * 1000;
      return {
        id: event.id || `${startMs}-${event.summary || "event"}`,
        title: event.summary || "(No title)",
        startMs,
        endMs,
        allDay: Boolean(event.start?.date && !event.start?.dateTime),
        calendarName: "Google Calendar",
        location: event.location || undefined,
        href: event.htmlLink || undefined
      };
    })
    .filter((event) => Number.isFinite(event.startMs) && event.startMs > 0)
    .sort((a, b) => a.startMs - b.startMs);
}
