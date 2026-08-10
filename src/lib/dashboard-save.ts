/**
 * Save bookkeeping for the manual dashboard state.
 *
 * Edits autosave on a debounce, which produced two problems worth pinning down
 * in one place:
 *
 * - Loading feeds the server's own values back through the same code path, so
 *   without a comparison the app wrote them straight back and reported "Saved"
 *   before the user had touched anything.
 * - A refresh that lands inside the debounce window used to cancel the pending
 *   write and then overwrite the edit with the server's older copy, so anyone
 *   who typed and hit Refresh to check lost exactly what they were checking on.
 */

import type { CollapsibleId, WidgetId } from "@/lib/dashboard-layout";
import type { ManualState } from "@/lib/types";

export type DashboardStatePayload = {
  manual: ManualState;
  widgetOrder: WidgetId[];
  collapsed: CollapsibleId[];
};

/**
 * Stable string for a payload, used to tell "the user changed something" from
 * "this is the value we just loaded". Key order is fixed by construction here,
 * so equal payloads always serialize identically.
 */
export function serializeState(payload: DashboardStatePayload): string {
  return JSON.stringify({
    manual: payload.manual,
    widgetOrder: payload.widgetOrder,
    collapsed: payload.collapsed
  });
}

/**
 * Whether `payload` differs from what the server is known to hold.
 *
 * A null snapshot means nothing has been loaded or written yet, so there is no
 * baseline to compare against and no save should be scheduled.
 */
export function hasUnsavedChanges(
  payload: DashboardStatePayload,
  savedSnapshot: string | null
): boolean {
  if (savedSnapshot === null) return false;
  return serializeState(payload) !== savedSnapshot;
}
