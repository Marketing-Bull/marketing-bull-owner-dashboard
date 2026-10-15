/**
 * ClickUp due dates, client-safe (no Node imports) so the Tasks screen and the
 * server read them the same way.
 *
 * A due date set without a time ("date only") is stored by ClickUp as 04:00 on
 * that day in the owner's timezone. Compared as an instant, it reads as overdue
 * from 4 AM on the due day. A date-only task is only overdue once its day has
 * ended; a task with a real time is overdue once that time passes.
 */

/**
 * Whether a due timestamp carries a real time of day.
 *
 * The API's own `due_date_time` flag wins when ClickUp sends one. Otherwise the
 * 04:00:00.000 local stamp is the date-only marker. That is local time on
 * whatever machine runs the app, which is the same day the rest of the
 * dashboard already uses; set `TZ` on the host if it isn't the owner's zone.
 */
export function dueHasTime(dueMs: number, flag?: unknown): boolean {
  if (typeof flag === "boolean") return flag;
  const due = new Date(dueMs);
  const dateOnly =
    due.getHours() === 4 && due.getMinutes() === 0 && due.getSeconds() === 0 && due.getMilliseconds() === 0;
  return !dateOnly;
}

export function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Overdue now? `hasTime` false means a date-only due date. */
export function isDueOverdue(dueMs: number, hasTime: boolean, nowMs: number = Date.now()): boolean {
  return hasTime ? dueMs < nowMs : dueMs < startOfLocalDay(nowMs);
}
