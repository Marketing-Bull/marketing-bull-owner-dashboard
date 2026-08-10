import { afterEach, describe, expect, it } from "vitest";
import { clickUpApiBase, pickStatusForDone } from "@/lib/clickup";

/**
 * Cover for the only code in the app that mutates real ClickUp tasks.
 *
 * Status names are per-list, so the name has to be discovered rather than
 * assumed. The case that matters most is the refusal: guessing a status would
 * move a real work item into a state nobody asked for, so "no suitable status"
 * must return null and let the caller fail loudly.
 */

const originalBase = process.env.OWNER_DASHBOARD_CLICKUP_API_BASE;

afterEach(() => {
  if (originalBase === undefined) delete process.env.OWNER_DASHBOARD_CLICKUP_API_BASE;
  else process.env.OWNER_DASHBOARD_CLICKUP_API_BASE = originalBase;
});

describe("pickStatusForDone", () => {
  const statuses = [
    { status: "to do", type: "open" },
    { status: "in progress", type: "custom" },
    { status: "Complete", type: "closed" }
  ];

  it("picks the list's own closed status rather than a hardcoded name", () => {
    expect(pickStatusForDone(statuses, true)).toBe("Complete");
  });

  it("picks the open status when unchecking", () => {
    expect(pickStatusForDone(statuses, false)).toBe("to do");
  });

  it("accepts 'done' as a finished type, which some lists use instead of 'closed'", () => {
    expect(pickStatusForDone([{ status: "Shipped", type: "done" }], true)).toBe("Shipped");
  });

  it("prefers a closed status over a done status when both exist", () => {
    const both = [
      { status: "Done", type: "done" },
      { status: "Closed", type: "closed" }
    ];
    expect(pickStatusForDone(both, true)).toBe("Closed");
  });

  it("refuses to guess when the list has no finished status", () => {
    // Writing "in progress" here would silently move a real task sideways.
    expect(pickStatusForDone([{ status: "in progress", type: "custom" }], true)).toBeNull();
  });

  it("refuses to guess when the list has no open status", () => {
    expect(pickStatusForDone([{ status: "Complete", type: "closed" }], false)).toBeNull();
  });

  it("never treats a custom status as finished, whatever it is called", () => {
    expect(pickStatusForDone([{ status: "Done-ish", type: "custom" }], true)).toBeNull();
  });

  it("survives malformed status payloads", () => {
    expect(pickStatusForDone(undefined, true)).toBeNull();
    expect(pickStatusForDone([], true)).toBeNull();
    expect(pickStatusForDone([{ type: "closed" }], true)).toBeNull();
    expect(pickStatusForDone([{ status: "", type: "closed" }], true)).toBeNull();
    expect(pickStatusForDone([{ status: "Complete" }], true)).toBeNull();
  });

  it("matches the type case-insensitively", () => {
    expect(pickStatusForDone([{ status: "Complete", type: "CLOSED" }], true)).toBe("Complete");
  });
});

describe("clickUpApiBase", () => {
  it("defaults to the real API", () => {
    delete process.env.OWNER_DASHBOARD_CLICKUP_API_BASE;
    expect(clickUpApiBase()).toBe("https://api.clickup.com/api/v2");
  });

  it("can be pointed at a stand-in, with a trailing slash tolerated", () => {
    process.env.OWNER_DASHBOARD_CLICKUP_API_BASE = "http://127.0.0.1:4100/";
    expect(clickUpApiBase()).toBe("http://127.0.0.1:4100");
  });

  it("ignores a blank override rather than building a relative URL", () => {
    process.env.OWNER_DASHBOARD_CLICKUP_API_BASE = "   ";
    expect(clickUpApiBase()).toBe("https://api.clickup.com/api/v2");
  });
});
