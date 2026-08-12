/**
 * Daily history and streak derivation.
 *
 * `dashboard_state` holds exactly one row, so every save overwrote the day
 * before it and nothing about yesterday survived. That is why the streak used
 * to be a number typed in by hand: there was no record to count. This module
 * defines the daily snapshot and derives the streak from it, so the number on
 * screen is measured rather than self-reported.
 *
 * Everything here is pure -- no database, no `Date.now()` baked into the
 * logic -- so the date arithmetic can be tested directly. That matters here:
 * day-boundary maths is exactly what broke the calendar grid once already.
 */

import { dayKey } from "@/lib/calendar-days";
import type { HistoryEntry, ManualState } from "@/lib/types";

/**
 * How far back history is read.
 *
 * A streak longer than this window reads as capped at the window, which is a
 * deliberate trade: a year of rows is cheap to load, and a 365-day streak is a
 * problem worth having.
 */
export const HISTORY_LOOKBACK_DAYS = 365;

/** The local day a snapshot belongs to. Never derived from toISOString(). */
export function todayKey(now: Date = new Date()): string {
  return dayKey(now);
}

/**
 * Moves a `YYYY-MM-DD` key by whole days, staying in local time.
 *
 * Anchored at noon rather than midnight: in zones where DST skips midnight
 * (America/Santiago, Asia/Beirut) a midnight anchor lands on the previous day,
 * and every shift after it is off by one. Noon is never skipped.
 */
export function shiftDayKey(day: string, deltaDays: number): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(date)) {
    return day;
  }

  const anchor = new Date(year, month - 1, date, 12);
  anchor.setDate(anchor.getDate() + deltaDays);
  return dayKey(anchor);
}

/** Snapshot of the values worth keeping for a single day. */
export function buildHistorySnapshot(manual: ManualState, day: string): HistoryEntry {
  return {
    day,
    dailyWin: manual.hyperfocus.multiply.dailyWin,
    lens: manual.hyperfocus.lens,
    target: manual.hyperfocus.target,
    bottleneck: manual.hyperfocus.bottleneck,
    mrrCurrent: manual.mrr.current,
    mrrProjected: manual.mrr.projected,
    mrrMomDelta: manual.mrr.momDelta,
    goals: [...manual.goals] as ManualState["goals"],
    whatsImportant: manual.whatsImportant,
    callsMade: manual.phoneCalls.made.length,
    callsPlanned: manual.phoneCalls.toMake.length
  };
}

/**
 * Whether a day counts toward the streak.
 *
 * The Multiply step is "repeat the daily win", so a recorded win is the thing
 * being counted. A day with the field left blank did not happen, however much
 * else was edited that day.
 */
export function countsTowardStreak(entry: HistoryEntry): boolean {
  return entry.dailyWin.trim().length > 0;
}

/**
 * Consecutive days ending today with a daily win recorded.
 *
 * Today being blank is not a broken streak -- it is the morning. So counting
 * starts at yesterday in that case, and only a full missed day ends the run.
 */
export function computeStreak(entries: HistoryEntry[], today: string): number {
  const recorded = new Set(entries.filter(countsTowardStreak).map((entry) => entry.day));

  let cursor = recorded.has(today) ? today : shiftDayKey(today, -1);
  let streak = 0;

  while (recorded.has(cursor)) {
    streak += 1;
    cursor = shiftDayKey(cursor, -1);
  }

  return streak;
}

/**
 * History with today's row replaced by what is currently on screen.
 *
 * Today's stored row only exists after a save, and saves are debounced. Without
 * this the streak would sit stale for the length of the debounce every time the
 * daily win is typed, which reads as the feature being broken.
 */
export function withTodaySnapshot(
  entries: HistoryEntry[],
  manual: ManualState,
  today: string
): HistoryEntry[] {
  return [
    ...entries.filter((entry) => entry.day !== today),
    buildHistorySnapshot(manual, today)
  ];
}
