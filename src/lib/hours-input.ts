/**
 * Parsing and labels for the Time screen's hours field.
 *
 * Hours arrive in three shapes and one field has to take all of them: a quarter
 * hour tapped off a preset (0.25), a decimal read off a timer (1.35), and clock
 * or duration shorthand (1:21, 90m, 1h21m). A stepper alone makes 1.35
 * unreachable; a bare decimal input makes 15 minutes a calculation. Both are
 * accepted here so neither entry style is second class.
 *
 * Everything is stored as decimal hours, which is what `time_entries.hours`
 * holds and what the rate math multiplies.
 */

/** One-tap durations, in decimal hours. */
export const HOURS_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const;

/** Matches the `hours > 0 AND hours <= 24` constraint on `time_entries`. */
export const MAX_HOURS = 24;

const DECIMAL = /^\d*\.?\d+$/;
const CLOCK = /^(\d+)?:(\d{1,2})$/;
const DURATION_PART = /(\d*\.?\d+)\s*(hours|hour|hrs|hr|h|minutes|minute|mins|min|m)/g;

/**
 * Rounds to whole seconds' worth of precision and rejects anything the time
 * entry table would refuse. Returns null rather than a clamped value: silently
 * turning 30 hours into 24 would log time nobody worked.
 */
function settle(hours: number): number | null {
  if (!Number.isFinite(hours)) return null;
  const rounded = Math.round(hours * 100) / 100;
  if (rounded <= 0 || rounded > MAX_HOURS) return null;
  return rounded;
}

export function parseHoursInput(value: string): number | null {
  const text = value.trim().toLowerCase();
  if (!text) return null;

  const clock = CLOCK.exec(text);
  if (clock) {
    const minutes = Number(clock[2]);
    if (minutes > 59) return null;
    return settle(Number(clock[1] ?? "0") + minutes / 60);
  }

  if (DECIMAL.test(text)) return settle(Number(text));

  let total = 0;
  let matched = false;
  for (const [, amount, unit] of text.matchAll(DURATION_PART)) {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed)) return null;
    total += unit.startsWith("h") ? parsed : parsed / 60;
    matched = true;
  }
  // Anything left over after the recognised parts means the input was not a
  // duration at all ("1h twice"), so it must not be read as one.
  if (!matched || text.replace(DURATION_PART, "").replace(/\s+/g, "")) return null;
  return settle(total);
}

/** The stored form: `1.35`, `1`, `0.25` — never `1.350000000000001`. */
export function formatHours(hours: number): string {
  return String(Math.round(hours * 100) / 100);
}

/** The readable form beside the field: `1 hr 21 min`. */
export function describeHours(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!wholeHours) return `${minutes} min`;
  if (!minutes) return `${wholeHours} hr`;
  return `${wholeHours} hr ${minutes} min`;
}

/**
 * Steps the field by a quarter hour. Unparseable text steps from zero so the
 * buttons still work on an empty or half-typed field.
 */
export function stepHours(value: string, delta: number): string {
  const current = parseHoursInput(value) ?? 0;
  const next = settle(current + delta);
  return next === null ? "" : formatHours(next);
}

/** Label for a preset button: `15m`, `45m`, `1h`, `1.5h`. */
export function presetLabel(hours: number): string {
  return hours < 1 ? `${Math.round(hours * 60)}m` : `${formatHours(hours)}h`;
}

const CLOCK_HHMM = /^(\d{1,2}):(\d{2})$/;

/** Minutes since midnight from an HTML `type="time"` value (`HH:MM`). */
function minutesFromHHmm(value: string): number | null {
  const match = CLOCK_HHMM.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function hhmmFromMinutes(totalMinutes: number): string {
  const day = 24 * 60;
  const normalized = ((totalMinutes % day) + day) % day;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Decimal hours between two clock times. When end is not after start, the span
 * wraps overnight (+24h). Returns null for unparseable clocks or spans the
 * time entry table would refuse.
 */
export function hoursBetween(startHHmm: string, endHHmm: string): number | null {
  const start = minutesFromHHmm(startHHmm);
  const end = minutesFromHHmm(endHHmm);
  if (start === null || end === null) return null;
  let minutes = end - start;
  if (minutes <= 0) minutes += 24 * 60;
  return settle(minutes / 60);
}

/**
 * End clock time after adding decimal hours to a start time. Wraps past midnight.
 * Returns null when start or hours cannot be settled.
 */
export function addHoursToTime(startHHmm: string, hours: number): string | null {
  const start = minutesFromHHmm(startHHmm);
  if (start === null) return null;
  const settled = settle(hours);
  if (settled === null) return null;
  return hhmmFromMinutes(start + Math.round(settled * 60));
}
