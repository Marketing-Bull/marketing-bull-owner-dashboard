/**
 * Client-safe helpers for the Mileage form.
 */

/** Why the one-way miles may no longer match the addresses. */
export type MilesStaleState = "cleared" | "kept" | null;

/**
 * What happens to the one-way miles when the user edits From or To.
 *
 * Provider-calculated miles describe the old address pair, so they are
 * cleared: auto-route refills them when Maps is configured, and the required
 * field makes the user re-enter them when it is not. Manually typed miles are
 * kept (the edit may be a typo fix) but flagged so the user double-checks.
 */
export function milesAfterAddressChange(current: { miles: string; calculationSource: "manual" | "provider" }, previousStale: MilesStaleState = null): { miles: string; stale: MilesStaleState } {
  if (current.calculationSource === "provider") return { miles: "", stale: current.miles.trim() ? "cleared" : previousStale };
  if (current.miles.trim()) return { miles: current.miles, stale: "kept" };
  return { miles: current.miles, stale: previousStale };
}

export function staleMilesHint(stale: MilesStaleState, mapsConfigured: boolean): string | null {
  if (stale === "cleared") return mapsConfigured
    ? "Addresses changed — calculated miles cleared. They will recalculate, or enter them manually."
    : "Addresses changed — calculated miles cleared. Enter miles manually.";
  if (stale === "kept") return "Addresses changed since these miles were entered — double-check them.";
  return null;
}
