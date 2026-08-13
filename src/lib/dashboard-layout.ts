export const DEFAULT_WIDGET_ORDER = [
  "whatsImportant",
  "calendar",
  "projects",
  "upNext",
  "activeProjects",
  "clients",
  "hours",
  "mrr",
  "goals",
  "phoneCalls",
] as const;

export type WidgetId = (typeof DEFAULT_WIDGET_ORDER)[number];

/** Orders persisted by builds that still included Today's Snapshot. */
export const LEGACY_WIDGET_ORDERS = [[
  "goals",
  "whatsImportant",
  "openSlot",
  "upNext",
  "calendar",
  "phoneCalls",
  "projects",
  "activeProjects",
  "clients",
  "mrr",
  "hours"
], [
  "projects",
  "activeProjects",
  "clients",
  "mrr",
  "hours",
  "calendar",
  "goals",
  "upNext",
  "phoneCalls",
  "whatsImportant",
  "openSlot"
]] as const;

/** Kept for the old-database upgrade test and any callers importing it. */
export const LEGACY_WIDGET_ORDER = LEGACY_WIDGET_ORDERS[1];

export const WIDGET_LABELS: Record<WidgetId, string> = {
  whatsImportant: "Daily Note",
  calendar: "Calendar",
  projects: "Project Priorities",
  upNext: "ClickUp Tasks",
  activeProjects: "Active Projects",
  clients: "Clients",
  hours: "Time by Project",
  mrr: "Revenue",
  goals: "Next Steps",
  phoneCalls: "Phone Calls"
};

/**
 * Panels that can be collapsed.
 *
 * The Daily State panel sits above the draggable grid rather than inside it,
 * so it gets its own persisted id instead of being folded into the widget
 * order. Keep the value stable: it is stored in saved dashboard state.
 */
export const HYPERFOCUS_PANEL_ID = "hyperfocus";

export const COLLAPSIBLE_IDS = [HYPERFOCUS_PANEL_ID, ...DEFAULT_WIDGET_ORDER] as const;

export type CollapsibleId = (typeof COLLAPSIBLE_IDS)[number];

export function isCollapsibleId(value: unknown): value is CollapsibleId {
  return COLLAPSIBLE_IDS.includes(value as CollapsibleId);
}
