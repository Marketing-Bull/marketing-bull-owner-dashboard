import { describe, expect, it } from "vitest";
import {
  addHoursToTime,
  describeHours,
  formatHours,
  hoursBetween,
  parseHoursInput,
  presetLabel,
  stepHours
} from "@/lib/hours-input";

describe("hours input", () => {
  it("reads decimals exactly as typed", () => {
    expect(parseHoursInput("1.35")).toBe(1.35);
    expect(parseHoursInput(" 0.25 ")).toBe(0.25);
    expect(parseHoursInput(".5")).toBe(0.5);
    expect(parseHoursInput("8")).toBe(8);
  });

  it("reads clock and duration shorthand", () => {
    expect(parseHoursInput("1:21")).toBe(1.35);
    expect(parseHoursInput(":45")).toBe(0.75);
    expect(parseHoursInput("90m")).toBe(1.5);
    expect(parseHoursInput("45 min")).toBe(0.75);
    expect(parseHoursInput("1h")).toBe(1);
    expect(parseHoursInput("1h21m")).toBe(1.35);
    expect(parseHoursInput("1 hr 30 mins")).toBe(1.5);
    expect(parseHoursInput("2 hours")).toBe(2);
  });

  it("rejects what the time entry table would refuse", () => {
    expect(parseHoursInput("")).toBeNull();
    expect(parseHoursInput("0")).toBeNull();
    expect(parseHoursInput("-2")).toBeNull();
    expect(parseHoursInput("25")).toBeNull();
    expect(parseHoursInput("1:75")).toBeNull();
    expect(parseHoursInput("lunch")).toBeNull();
    expect(parseHoursInput("1h twice")).toBeNull();
  });

  it("rounds to stored precision without inventing hours", () => {
    expect(parseHoursInput("1:20")).toBe(1.33);
    expect(formatHours(1.35)).toBe("1.35");
    expect(formatHours(1)).toBe("1");
    expect(describeHours(1.35)).toBe("1 hr 21 min");
    expect(describeHours(0.25)).toBe("15 min");
    expect(describeHours(2)).toBe("2 hr");
  });

  it("steps by a quarter hour from any starting point", () => {
    expect(stepHours("", 0.25)).toBe("0.25");
    expect(stepHours("0.25", 0.25)).toBe("0.5");
    expect(stepHours("1:21", 0.25)).toBe("1.6");
    expect(stepHours("0.25", -0.25)).toBe("");
    expect(stepHours("24", 0.25)).toBe("");
  });

  it("labels presets the way they are spoken", () => {
    expect(presetLabel(0.25)).toBe("15m");
    expect(presetLabel(0.75)).toBe("45m");
    expect(presetLabel(1)).toBe("1h");
    expect(presetLabel(1.5)).toBe("1.5h");
  });
});

describe("hoursBetween / addHoursToTime", () => {
  it("computes same-day spans", () => {
    expect(hoursBetween("09:00", "10:30")).toBe(1.5);
    expect(hoursBetween("09:00", "09:15")).toBe(0.25);
    expect(hoursBetween("08:00", "17:00")).toBe(9);
  });

  it("wraps overnight when end is not after start", () => {
    expect(hoursBetween("22:00", "01:00")).toBe(3);
    expect(hoursBetween("23:30", "00:15")).toBe(0.75);
    expect(hoursBetween("09:00", "09:00")).toBe(24);
  });

  it("rejects unparseable clocks and over-limit spans", () => {
    expect(hoursBetween("", "10:00")).toBeNull();
    expect(hoursBetween("25:00", "10:00")).toBeNull();
    expect(hoursBetween("09:00", "99:99")).toBeNull();
  });

  it("adds hours onto a start clock, wrapping midnight", () => {
    expect(addHoursToTime("09:00", 1.5)).toBe("10:30");
    expect(addHoursToTime("09:00", 0.25)).toBe("09:15");
    expect(addHoursToTime("22:00", 3)).toBe("01:00");
    expect(addHoursToTime("23:45", 0.5)).toBe("00:15");
  });

  it("refuses hours the time entry table would refuse", () => {
    expect(addHoursToTime("09:00", 0)).toBeNull();
    expect(addHoursToTime("09:00", 25)).toBeNull();
    expect(addHoursToTime("", 1)).toBeNull();
    expect(addHoursToTime("bad", 1)).toBeNull();
  });
});
