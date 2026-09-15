import { describe, expect, it } from "vitest";
import {
  COLLAPSIBLE_IDS,
  DEFAULT_WIDGET_ORDER,
  HYPERFOCUS_PANEL_ID,
  isCollapsibleId
} from "@/lib/dashboard-layout";

describe("collapsible ids", () => {
  it("covers every widget plus the hyperfocus panel", () => {
    for (const id of DEFAULT_WIDGET_ORDER) {
      expect(isCollapsibleId(id), id).toBe(true);
    }
    expect(isCollapsibleId(HYPERFOCUS_PANEL_ID)).toBe(true);
    expect(COLLAPSIBLE_IDS).toHaveLength(DEFAULT_WIDGET_ORDER.length + 1);
  });

  it("rejects unknown values so a stale id cannot hide a live panel", () => {
    for (const value of ["", "nope", "Projects", null, undefined, 3, {}, []]) {
      expect(isCollapsibleId(value), String(value)).toBe(false);
    }
  });
});