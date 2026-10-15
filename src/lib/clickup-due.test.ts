import { afterEach, describe, expect, it } from "vitest";
import { dueHasTime, isDueOverdue, startOfLocalDay } from "@/lib/clickup-due";

const originalTimezone = process.env.TZ;
afterEach(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

describe("dueHasTime", () => {
  it("treats the 04:00 local stamp as a date-only due date, in summer and winter", () => {
    process.env.TZ = "America/New_York";
    // The owner's real tasks: 08:00Z in September (EDT), 09:00Z in January (EST).
    expect(dueHasTime(Date.UTC(2026, 8, 11, 8, 0, 0))).toBe(false);
    expect(dueHasTime(Date.UTC(2027, 0, 15, 9, 0, 0))).toBe(false);
  });

  it("treats any other time of day as a real time", () => {
    process.env.TZ = "America/New_York";
    expect(dueHasTime(Date.UTC(2026, 8, 2, 23, 0, 0))).toBe(true); // 7 PM
    expect(dueHasTime(Date.UTC(2026, 8, 11, 8, 30, 0))).toBe(true); // 4:30 AM
  });

  it("lets ClickUp's own flag win when the payload has one", () => {
    process.env.TZ = "America/New_York";
    const fourAm = Date.UTC(2026, 8, 11, 8, 0, 0);
    expect(dueHasTime(fourAm, true)).toBe(true);
    expect(dueHasTime(Date.UTC(2026, 8, 2, 23, 0, 0), false)).toBe(false);
  });
});

describe("isDueOverdue", () => {
  const now = new Date(2026, 9, 15, 10, 0, 0).getTime();

  it("keeps a date-only task due today out of overdue until the day ends", () => {
    const dueToday = new Date(2026, 9, 15, 4, 0, 0).getTime();
    expect(isDueOverdue(dueToday, false, now)).toBe(false);
    expect(isDueOverdue(dueToday, false, new Date(2026, 9, 16, 0, 1, 0).getTime())).toBe(true);
  });

  it("marks a timed task overdue as soon as its time passes", () => {
    expect(isDueOverdue(new Date(2026, 9, 15, 9, 0, 0).getTime(), true, now)).toBe(true);
    expect(isDueOverdue(new Date(2026, 9, 15, 17, 0, 0).getTime(), true, now)).toBe(false);
  });

  it("finds the local midnight", () => {
    expect(startOfLocalDay(now)).toBe(new Date(2026, 9, 15).getTime());
  });
});
