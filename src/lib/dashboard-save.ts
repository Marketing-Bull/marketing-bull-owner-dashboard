/** Save bookkeeping for the manual dashboard state. */

import type { CollapsibleId, WidgetId } from "@/lib/dashboard-layout";
import type { ManualState } from "@/lib/types";

export type DashboardStatePayload = {
  manual: ManualState;
  widgetOrder: WidgetId[];
  collapsed: CollapsibleId[];
};

export function serializeState(payload: DashboardStatePayload): string {
  return JSON.stringify({
    manual: payload.manual,
    widgetOrder: payload.widgetOrder,
    collapsed: payload.collapsed
  });
}

export function hasUnsavedChanges(
  payload: DashboardStatePayload,
  savedSnapshot: string | null
): boolean {
  if (savedSnapshot === null) return false;
  return serializeState(payload) !== savedSnapshot;
}