import { afterEach, describe, expect, it } from "vitest";
import { buildDayColumns, dayKey } from "@/lib/calendar-days";
import { normalizeGogEvents } from "@/lib/calendar-events";
import type { CalendarEvent } from "@/lib/types";

/**
 * Regression cover for the UTC-vs-local grouping bug.
 *
 * The original implementation keyed days off `toISOString()`, which is UTC.
 * In America/New_York every event from 20:00 grouped under tomorrow; in
 * America/Los_Angeles from 17:00; in Europe/Berlin the whole grid shifted a
 * day. These tests fail against that implementation and pass against the
 * local-component one, so they must run under several zones -- a suite that
 * only runs in UTC cannot tell the two apart.
 */

const ZONES = [
  "America/New_York", // UTC-4 in August
  "America/Los_Angeles", // UTC-7
  "UTC",
  "Europe/Berlin", // UTC+2
  "Asia/Kolkata", // UTC+5:30, non-hour offset
  "Asia/Tokyo", // UTC+9
  "Australia/Sydney" // UTC+10
];

const originalTimeZone = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTimeZone;
});

function inZone<T>(timeZone: string, run: () => T): T {
  process.env.TZ = timeZone;
  return run();
}

function localEvent(id: string, year: number, month: number, day: number, hour: number): CalendarEvent {
  const start = new Date(year, month - 1, day, hour, 0, 0, 0);
  return {
    id,
    title: id,
    startMs: start.getTime(),
    endMs: start.getTime() + 30 * 60 * 1000,
    allDay: false,
    calendarName: "Test"
  };
}

describe("dayKey", () => {
  for (const zone of ZONES) {
    it(`names the local calendar day in ${zone}`, () => {
      inZone(zone, () => {
        // 23:30 local is the case UTC-based keys got wrong west of UTC.
        expect(dayKey(new Date(2026, 7, 10, 23, 30))).toBe("2026-08-10");
        expect(dayKey(new Date(2026, 7, 10, 0, 30))).toBe("2026-08-10");
        expect(dayKey(new Date(2026, 0, 1, 20, 0))).toBe("2026-01-01");
      });
    });
  }

  it("zero-pads single-digit months and days", () => {
    inZone("UTC", () => {
      expect(dayKey(new Date(2026, 2, 5, 12, 0))).toBe("2026-03-05");
    });
  });
});

describe("buildDayColumns", () => {
  for (const zone of ZONES) {
    it(`files every hour of every shown day into its own local column in ${zone}`, () => {
      inZone(zone, () => {
        const from = new Date(2026, 7, 10, 9, 0);
        const events: CalendarEvent[] = [];

        for (let dayOffset = 0; dayOffset < 3; dayOffset += 1) {
          for (const hour of [0, 7, 13, 17, 20, 23]) {
            events.push(localEvent(`d${dayOffset}h${hour}`, 2026, 8, 10 + dayOffset, hour));
          }
        }

        const columns = buildDayColumns(events, 3, from);
        expect(columns.map((column) => column.key)).toEqual(["2026-08-10", "2026-08-11", "2026-08-12"]);

        // Nothing inside the window may be dropped or land in the wrong column.
        const placed = columns.flatMap((column) => column.events.map((event) => event.id));
        expect(placed).toHaveLength(events.length);

        columns.forEach((column, dayOffset) => {
          expect(column.events.map((event) => event.id).sort()).toEqual(
            [0, 7, 13, 17, 20, 23].map((hour) => `d${dayOffset}h${hour}`).sort()
          );
        });
      });
    });
  }

  it("keeps a 20:00 event on its own day rather than tomorrow", () => {
    // The exact America/New_York symptom from the original report.
    inZone("America/New_York", () => {
      const columns = buildDayColumns(
        [localEvent("evening", 2026, 8, 10, 20)],
        3,
        new Date(2026, 7, 10, 9, 0)
      );
      expect(columns[0].events.map((event) => event.id)).toEqual(["evening"]);
      expect(columns[1].events).toHaveLength(0);
    });
  });

  it("keeps a 17:00 event on its own day rather than tomorrow", () => {
    // The America/Los_Angeles symptom: a 5pm meeting read as tomorrow.
    inZone("America/Los_Angeles", () => {
      const columns = buildDayColumns(
        [localEvent("late-afternoon", 2026, 8, 10, 17)],
        3,
        new Date(2026, 7, 10, 9, 0)
      );
      expect(columns[0].events.map((event) => event.id)).toEqual(["late-afternoon"]);
    });
  });

  it("labels each column with its own local date", () => {
    inZone("Europe/Berlin", () => {
      const columns = buildDayColumns([], 3, new Date(2026, 7, 10, 9, 0));
      // Berlin is where the whole grid used to slide a day; the label and the
      // key must describe the same date.
      expect(columns[0].label).toContain("Aug 10");
      expect(columns[1].label).toContain("Aug 11");
      expect(columns[2].label).toContain("Aug 12");
    });
  });

  it("follows the provided local day rather than a fixed August window", () => {
    inZone("America/New_York", () => {
      const columns = buildDayColumns([], 3, new Date(2026, 10, 3, 9, 0));
      expect(columns.map((column) => column.key)).toEqual(["2026-11-03", "2026-11-04", "2026-11-05"]);
    });
  });

  it("drops events outside the window without disturbing the rest", () => {
    inZone("America/New_York", () => {
      const columns = buildDayColumns(
        [localEvent("inside", 2026, 8, 11, 12), localEvent("outside", 2026, 8, 20, 12)],
        3,
        new Date(2026, 7, 10, 9, 0)
      );
      expect(columns.flatMap((column) => column.events.map((event) => event.id))).toEqual(["inside"]);
    });
  });

  it("groups an all-day event under the date Google names", () => {
    // parseEventDate and dayKey must agree: an all-day "2026-08-10" parsed as
    // UTC midnight lands on 2026-08-09 in any zone west of UTC.
    for (const zone of ["America/New_York", "America/Los_Angeles", "UTC", "Asia/Tokyo"]) {
      inZone(zone, () => {
        const [event] = normalizeGogEvents([
          { id: "all-day", summary: "Offsite", start: { date: "2026-08-10" }, end: { date: "2026-08-11" } }
        ]);
        const columns = buildDayColumns([event], 3, new Date(2026, 7, 10, 9, 0));
        expect(columns[0].events.map((entry) => entry.id), `zone ${zone}`).toEqual(["all-day"]);
      });
    }
  });
});
