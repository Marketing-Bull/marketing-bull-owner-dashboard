import { describe, expect, it } from "vitest";
import { hasUnsavedChanges, serializeState, type DashboardStatePayload } from "@/lib/dashboard-save";
import { DEFAULT_WIDGET_ORDER } from "@/lib/dashboard-layout";
import { DEFAULT_MANUAL_STATE } from "@/lib/sample-data";

function payload(overrides: Partial<DashboardStatePayload> = {}): DashboardStatePayload {
  return {
    manual: DEFAULT_MANUAL_STATE,
    widgetOrder: [...DEFAULT_WIDGET_ORDER],
    collapsed: [],
    ...overrides
  };
}

describe("serializeState", () => {
  it("is stable for equal payloads built independently", () => {
    expect(serializeState(payload())).toBe(serializeState(payload()));
  });

  it("changes when any tracked slice changes", () => {
    const base = serializeState(payload());
    expect(serializeState(payload({ collapsed: ["calendar"] }))).not.toBe(base);
    expect(serializeState(payload({ widgetOrder: ["upNext", "calendar"] }))).not.toBe(base);
    expect(
      serializeState(
        payload({ manual: { ...DEFAULT_MANUAL_STATE, mrr: { ...DEFAULT_MANUAL_STATE.mrr, current: "99999" } } })
      )
    ).not.toBe(base);
  });
});

describe("hasUnsavedChanges", () => {
  it("reports nothing to save for the values just loaded", () => {
    const loaded = payload();
    expect(hasUnsavedChanges(loaded, serializeState(loaded))).toBe(false);
  });

  it("reports a change once a field is edited", () => {
    const snapshot = serializeState(payload());
    const edited = payload({
      manual: { ...DEFAULT_MANUAL_STATE, mrr: { ...DEFAULT_MANUAL_STATE.mrr, current: "777777" } }
    });
    expect(hasUnsavedChanges(edited, snapshot)).toBe(true);
  });

  it("still reports a change after an unrelated refresh restored the same snapshot", () => {
    const snapshot = serializeState(payload());
    const edited = payload({ collapsed: ["hyperfocus"] });
    expect(hasUnsavedChanges(edited, snapshot)).toBe(true);
    expect(hasUnsavedChanges(edited, serializeState(edited))).toBe(false);
  });

  it("stays quiet before anything has been loaded", () => {
    expect(hasUnsavedChanges(payload(), null)).toBe(false);
  });
});