import { describe, expect, it } from "vitest";
import { hasUnsavedChanges, serializeState, type DashboardStatePayload } from "@/lib/dashboard-save";
import { DEFAULT_WIDGET_ORDER } from "@/lib/dashboard-layout";
import { DEFAULT_MANUAL_STATE } from "@/lib/sample-data";

/**
 * Cover for issue #5.
 *
 * Two failures came out of the same missing comparison: the app wrote the
 * server's own values back on load (reporting "Saved" before any edit), and a
 * refresh inside the debounce window discarded a real edit.
 */

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
    expect(serializeState(payload({ collapsed: ["mrr"] }))).not.toBe(base);
    expect(serializeState(payload({ widgetOrder: ["mrr", ...DEFAULT_WIDGET_ORDER.filter((id) => id !== "mrr")] })))
      .not.toBe(base);
    expect(
      serializeState(
        payload({ manual: { ...DEFAULT_MANUAL_STATE, mrr: { ...DEFAULT_MANUAL_STATE.mrr, current: "99999" } } })
      )
    ).not.toBe(base);
  });
});

describe("hasUnsavedChanges", () => {
  it("reports nothing to save for the values just loaded", () => {
    // The regression that made the header claim "Saved" on a page the user
    // had not touched, and wrote a redundant PUT on every load.
    const loaded = payload();
    expect(hasUnsavedChanges(loaded, serializeState(loaded))).toBe(false);
  });

  it("reports a change once a field is edited", () => {
    // The case that must never be skipped: skipping it is silent data loss.
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
    // ...and once that edit is written, the new baseline settles it.
    expect(hasUnsavedChanges(edited, serializeState(edited))).toBe(false);
  });

  it("stays quiet before anything has been loaded", () => {
    // No baseline yet: the defaults on screen are not a user edit, and writing
    // them would clobber real server state with placeholder values.
    expect(hasUnsavedChanges(payload(), null)).toBe(false);
  });
});
