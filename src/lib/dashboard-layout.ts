export const DEFAULT_WIDGET_ORDER = [
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
] as const;

export type WidgetId = (typeof DEFAULT_WIDGET_ORDER)[number];

export const LEGACY_WIDGET_ORDER = [
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
] satisfies readonly WidgetId[];

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
