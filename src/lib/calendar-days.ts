/**
 * Calendar day bucketing.
 *
 * Extracted from the dashboard component so the grouping rules are importable
 * by tests -- this is where the UTC-vs-local bug lived, and it was previously
 * unreachable from anything but a browser.
 */

import type { CalendarEvent } from "@/lib/types";

export type DayColumn = {
  key: string;
  label: string;
  events: CalendarEvent[];
};

/**
 * Local-calendar day key, `YYYY-MM-DD`.
 *
 * Must not use toISOString(): that converts to UTC, so slicing the ISO string
 * names the wrong day for part of every day in any non-UTC zone. In UTC-4 an
 * 8pm event grouped under tomorrow; in UTC+2 the whole grid slid a day.
 */
export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDayLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
}

/**
 * Builds `dayCount` consecutive local-day columns starting at `from` (default
 * now) and files each event into the column matching its local date.
 *
 * Events outside the window are intentionally dropped -- the caller decides how
 * many days to show -- but nothing inside the window may go missing.
 */
export function buildDayColumns(
  events: CalendarEvent[],
  dayCount: number,
  from: Date = new Date()
): DayColumn[] {
  return Array.from({ length: dayCount }, (_, offset) => {
    const date = new Date(from);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    const key = dayKey(date);

    return {
      key,
      label: formatDayLabel(date),
      events: events.filter((event) => dayKey(new Date(event.startMs)) === key)
    };
  });
}
