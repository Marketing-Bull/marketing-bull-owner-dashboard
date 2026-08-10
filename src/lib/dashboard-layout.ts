export const DEFAULT_WIDGET_ORDER = [
  "projects",
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
