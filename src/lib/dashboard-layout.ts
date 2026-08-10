export const DEFAULT_WIDGET_ORDER = [
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
] as const;

export type WidgetId = (typeof DEFAULT_WIDGET_ORDER)[number];

/**
 * Panels that can be collapsed.
 *
 * The Daily Hyperfocus System sits above the draggable grid rather than inside
 * it, but it is the panel the request called out by name, so it gets its own id
 * here instead of being folded into the widget order.
 */
export const HYPERFOCUS_PANEL_ID = "hyperfocus";

export const COLLAPSIBLE_IDS = [HYPERFOCUS_PANEL_ID, ...DEFAULT_WIDGET_ORDER] as const;

export type CollapsibleId = (typeof COLLAPSIBLE_IDS)[number];

export function isCollapsibleId(value: unknown): value is CollapsibleId {
  return COLLAPSIBLE_IDS.includes(value as CollapsibleId);
}
