import { describe, expect, it } from "vitest";
import { normalizeDashboardData } from "@/lib/dashboard-data";

/**
 * Regression cover for the white-screen crash.
 *
 * `/api/dashboard` can proxy an arbitrary upstream, and the client used to cast
 * the body straight to `DashboardData`. A payload missing `hours` produced
 * "Cannot read properties of undefined (reading 'week')" and took down all nine
 * widgets, including the manual ones that never touch this data.
 *
 * The contract these tests pin down: whatever goes in, what comes out is always
 * safe to render.
 */

const MALFORMED_INPUTS: Array<[string, unknown]> = [
  ["the exact payload that crashed the page", { priorities: [], upNext: [] }],
  ["null", null],
  ["undefined", undefined],
  ["an empty object", {}],
  ["an array", []],
  ["a string", "not json"],
  ["a number", 42],
  ["hours present but null", { hours: null }],
  ["hours as the wrong type", { hours: "week" }],
  ["hours half-populated", { hours: { week: [] } }],
  ["priorities as an object", { priorities: {} }],
  ["upNext as a string", { upNext: "nope" }],
  ["entries that are null", { priorities: [null], upNext: [null] }]
];

describe("normalizeDashboardData", () => {
  for (const [label, input] of MALFORMED_INPUTS) {
    it(`returns a renderable shape for ${label}`, () => {
      const result = normalizeDashboardData(input);

      // These are precisely the accesses the component makes unguarded.
      expect(Array.isArray(result.hours.week)).toBe(true);
      expect(Array.isArray(result.hours.month)).toBe(true);
      expect(Array.isArray(result.upNext)).toBe(true);
      expect(Array.isArray(result.priorities)).toBe(true);
      expect(() => result.priorities.map((bucket) => bucket.projects.length)).not.toThrow();
    });
  }

  it("always returns all four priority buckets in order", () => {
    const result = normalizeDashboardData({ priorities: [{ key: "P2", label: "Queued", projects: [] }] });
    expect(result.priorities.map((bucket) => bucket.key)).toEqual(["P0", "P1", "P2", "P3"]);
  });

  it("preserves valid data unchanged", () => {
    const result = normalizeDashboardData({
      priorities: [{ key: "P0", label: "Critical", projects: [{ id: "a", title: "Ship it", href: "https://x" }] }],
      hours: { week: [{ label: "Dashboard", hours: 6.5 }], month: [] },
      upNext: [{ id: "t1", title: "Review", due: "Today 10:30", priority: "P1", done: true }],
      source: "live",
      generatedAt: 1_700_000_000_000
    });

    expect(result.priorities[0].projects).toEqual([
      { id: "a", title: "Ship it", subtitle: undefined, status: undefined, href: "https://x" }
    ]);
    expect(result.hours.week).toEqual([{ label: "Dashboard", hours: 6.5 }]);
    expect(result.upNext[0]).toMatchObject({ id: "t1", priority: "P1", done: true });
    expect(result.source).toBe("live");
    expect(result.generatedAt).toBe(1_700_000_000_000);
  });

  it("only reports 'live' when the upstream actually said so", () => {
    expect(normalizeDashboardData({}).source).toBe("sample");
    expect(normalizeDashboardData({ source: "anything-else" }).source).toBe("sample");
    expect(normalizeDashboardData({ source: "live" }).source).toBe("live");
  });

  it("carries fallbackReason through so the UI can warn", () => {
    expect(normalizeDashboardData({ fallbackReason: "ClickUp 401" }).fallbackReason).toBe("ClickUp 401");
    expect(normalizeDashboardData({}).fallbackReason).toBeUndefined();
  });

  it("coerces unusable numbers rather than rendering NaN", () => {
    const result = normalizeDashboardData({ hours: { week: [{ label: "Admin", hours: "lots" }], month: [] } });
    expect(result.hours.week).toEqual([{ label: "Admin", hours: 0 }]);
  });

  it("falls back to P3 for an unrecognised priority", () => {
    const result = normalizeDashboardData({ upNext: [{ id: "t", title: "x", priority: "URGENT" }] });
    expect(result.upNext[0].priority).toBe("P3");
  });

  it("gives every task and project a stable id", () => {
    const result = normalizeDashboardData({
      priorities: [{ key: "P0", projects: [{ title: "no id" }] }],
      upNext: [{ title: "no id" }]
    });
    expect(result.priorities[0].projects[0].id).toBeTruthy();
    expect(result.upNext[0].id).toBeTruthy();
  });
});
