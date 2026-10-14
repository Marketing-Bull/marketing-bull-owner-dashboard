/**
 * Client-safe helpers for the Time entry form.
 */

/**
 * Soft warning when billable work would save at a zero rate.
 * Non-blocking: callers show this inline and still allow save.
 */
export function billableZeroRateHint(billable: boolean, rate: number): string | null {
  if (!billable || rate > 0) return null;
  return "Billable at $0 — this entry won't add revenue. Set a rate or uncheck Billable.";
}
