/**
 * Streak and day-key tests.
 *
 * Weighted toward the day-boundary cases. A streak that silently resets, or
 * counts a day twice, is worse than no streak at all: the number looks
 * authoritative either way, and the whole point of deriving it from history was
 * to stop it being a number someone made up.
 *
 * Like the calendar suite, these set `TZ` per case. CI runs in UTC, and UTC is
 * the one zone where off-by-one day arithmetic is invisible.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  buildHistorySnapshot,
  computeStreak,
  countsTowardStreak,
  shiftDayKey,
  todayKey,
  withTodaySnapshot
} from "@/lib/history";
import { DEFAULT_MANUAL_STATE } from "@/lib/sample-data";
import type { HistoryEntry, ManualState } from "@/lib/types";

const originalTimezone = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTimezone;
});

function entry(day: string, dailyWin: string): HistoryEntry {
  return { ...buildHistorySnapshot(DEFAULT_MANUAL_STATE, day), dailyWin };
}

function manualWithWin(dailyWin: string): ManualState {
  return {
    ...DEFAULT_MANUAL_STATE,
    hyperfocus: {
      ...DEFAULT_MANUAL_STATE.hyperfocus,
      multiply: { dailyWin }
    }
  };
}

describe("shiftDayKey", () => {
  it("moves forward and back across a month boundary", () => {
    expect(shiftDayKey("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDayKey("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("moves across a year boundary", () => {
    expect(shiftDayKey("2025-12-31", 1)).toBe("2026-01-01");
    expect(shiftDayKey("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles the leap day", () => {
    expect(shiftDayKey("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDayKey("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("returns the input unchanged for a malformed key", () => {
    expect(shiftDayKey("not-a-day", -1)).toBe("not-a-day");
    expect(shiftDayKey("", -1)).toBe("");
  });

  // A midnight anchor lands on the previous day in zones where DST skips
  // midnight, which would shift every subsequent day by one.
  it.each([
    ["America/Santiago", "2026-09-06"],
    ["Asia/Beirut", "2026-03-29"],
    ["America/New_York", "2026-03-08"],
    ["Europe/Berlin", "2026-03-29"],
    ["Australia/Lord_Howe", "2026-10-04"]
  ])("steps cleanly across the DST transition in %s", (timezone, transitionDay) => {
    process.env.TZ = timezone;

    const next = shiftDayKey(transitionDay, 1);
    expect(shiftDayKey(next, -1)).toBe(transitionDay);

    const previous = shiftDayKey(transitionDay, -1);
    expect(shiftDayKey(previous, 1)).toBe(transitionDay);
  });

  it("stays consistent walking a full week backwards", () => {
    let cursor = "2026-08-12";
    const walked = [cursor];
    for (let step = 0; step < 7; step += 1) {
      cursor = shiftDayKey(cursor, -1);
      walked.push(cursor);
    }

    expect(walked).toEqual([
      "2026-08-12",
      "2026-08-11",
      "2026-08-10",
      "2026-08-09",
      "2026-08-08",
      "2026-08-07",
      "2026-08-06",
      "2026-08-05"
    ]);
  });
});

describe("todayKey", () => {
  it("names the local day, not the UTC one", () => {
    process.env.TZ = "America/New_York";
    // 01:30 UTC on the 13th is still the 12th in New York. toISOString-based
    // keying would file this under the wrong day.
    expect(todayKey(new Date("2026-08-13T01:30:00Z"))).toBe("2026-08-12");
  });

  it("names the local day when local time is ahead of UTC", () => {
    process.env.TZ = "Asia/Tokyo";
    expect(todayKey(new Date("2026-08-12T22:30:00Z"))).toBe("2026-08-13");
  });
});

describe("countsTowardStreak", () => {
  it("counts a day with a recorded win", () => {
    expect(countsTowardStreak(entry("2026-08-12", "Cleared the bottleneck first"))).toBe(true);
  });

  it("does not count a blank or whitespace-only win", () => {
    expect(countsTowardStreak(entry("2026-08-12", ""))).toBe(false);
    expect(countsTowardStreak(entry("2026-08-12", "   \n "))).toBe(false);
  });
});

describe("computeStreak", () => {
  const today = "2026-08-12";

  it("is zero with no history at all", () => {
    expect(computeStreak([], today)).toBe(0);
  });

  it("counts today plus the unbroken run before it", () => {
    const entries = [
      entry("2026-08-09", "win"),
      entry("2026-08-10", "win"),
      entry("2026-08-11", "win"),
      entry(today, "win")
    ];

    expect(computeStreak(entries, today)).toBe(4);
  });

  // The streak must not read as broken every morning before the win is typed.
  it("keeps yesterday's run when today is not filled in yet", () => {
    const entries = [entry("2026-08-10", "win"), entry("2026-08-11", "win")];

    expect(computeStreak(entries, today)).toBe(2);
  });

  it("ends the run at a missed day", () => {
    const entries = [
      entry("2026-08-08", "win"),
      entry("2026-08-09", "win"),
      // 2026-08-10 missed
      entry("2026-08-11", "win"),
      entry(today, "win")
    ];

    expect(computeStreak(entries, today)).toBe(2);
  });

  it("is zero once both today and yesterday are missed", () => {
    const entries = [entry("2026-08-08", "win"), entry("2026-08-09", "win")];

    expect(computeStreak(entries, today)).toBe(0);
  });

  it("ignores days recorded without a win", () => {
    const entries = [
      entry("2026-08-10", "win"),
      entry("2026-08-11", ""),
      entry(today, "win")
    ];

    // Today counts; 08-11 was recorded but blank, so the run stops there.
    expect(computeStreak(entries, today)).toBe(1);
  });

  it("ignores future rows", () => {
    const entries = [entry(today, "win"), entry("2026-08-13", "win")];

    expect(computeStreak(entries, today)).toBe(1);
  });

  it("does not depend on row order", () => {
    const entries = [
      entry("2026-08-11", "win"),
      entry(today, "win"),
      entry("2026-08-10", "win")
    ];

    expect(computeStreak(entries, today)).toBe(3);
  });

  it("counts a run that spans a month boundary", () => {
    const entries = [
      entry("2026-07-30", "win"),
      entry("2026-07-31", "win"),
      entry("2026-08-01", "win")
    ];

    expect(computeStreak(entries, "2026-08-01")).toBe(3);
  });

  it("counts a run that spans a DST transition", () => {
    process.env.TZ = "America/New_York";
    const entries = [
      entry("2026-03-07", "win"),
      entry("2026-03-08", "win"),
      entry("2026-03-09", "win")
    ];

    expect(computeStreak(entries, "2026-03-09")).toBe(3);
  });
});

describe("withTodaySnapshot", () => {
  const today = "2026-08-12";

  it("adds today from the live state when no row exists yet", () => {
    const entries = [entry("2026-08-11", "win")];
    const merged = withTodaySnapshot(entries, manualWithWin("typed just now"), today);

    expect(merged).toHaveLength(2);
    expect(merged.find((item) => item.day === today)?.dailyWin).toBe("typed just now");
  });

  it("replaces a stored row for today rather than duplicating it", () => {
    const entries = [entry(today, "saved earlier")];
    const merged = withTodaySnapshot(entries, manualWithWin("edited since"), today);

    expect(merged.filter((item) => item.day === today)).toHaveLength(1);
    expect(merged[0].dailyWin).toBe("edited since");
  });

  it("makes the streak reflect a win typed but not yet saved", () => {
    const entries = [entry("2026-08-10", "win"), entry("2026-08-11", "win")];

    expect(computeStreak(entries, today)).toBe(2);
    expect(computeStreak(withTodaySnapshot(entries, manualWithWin("typed"), today), today)).toBe(3);
  });

  it("drops the streak back when the win is cleared again", () => {
    const entries = [entry("2026-08-11", "win"), entry(today, "saved earlier")];

    expect(computeStreak(withTodaySnapshot(entries, manualWithWin(""), today), today)).toBe(1);
  });
});

describe("buildHistorySnapshot", () => {
  it("captures the fields worth keeping for the day", () => {
    const snapshot = buildHistorySnapshot(DEFAULT_MANUAL_STATE, "2026-08-12");

    expect(snapshot.day).toBe("2026-08-12");
    expect(snapshot.dailyWin).toBe(DEFAULT_MANUAL_STATE.hyperfocus.multiply.dailyWin);
    expect(snapshot.lens).toBe(DEFAULT_MANUAL_STATE.hyperfocus.lens);
    expect(snapshot.mrrCurrent).toBe(DEFAULT_MANUAL_STATE.mrr.current);
    expect(snapshot.goals).toEqual(DEFAULT_MANUAL_STATE.goals);
    expect(snapshot.callsMade).toBe(DEFAULT_MANUAL_STATE.phoneCalls.made.length);
    expect(snapshot.callsPlanned).toBe(DEFAULT_MANUAL_STATE.phoneCalls.toMake.length);
  });

  it("copies goals rather than aliasing the live state", () => {
    const manual = structuredClone(DEFAULT_MANUAL_STATE);
    const snapshot = buildHistorySnapshot(manual, "2026-08-12");
    manual.goals[0] = "changed after the snapshot";

    expect(snapshot.goals[0]).not.toBe("changed after the snapshot");
  });
});
