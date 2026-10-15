import { describe, expect, it } from "vitest";
import { parseMoneyInput } from "@/lib/money-input";

describe("parseMoneyInput", () => {
  it("accepts the ways people type money", () => {
    expect(parseMoneyInput("2500").value).toBe(2500);
    expect(parseMoneyInput("2,500").value).toBe(2500);
    expect(parseMoneyInput("$150").value).toBe(150);
    expect(parseMoneyInput(" $2,750.50 ").value).toBe(2750.5);
    expect(parseMoneyInput(".5").value).toBe(0.5);
    expect(parseMoneyInput(99).value).toBe(99);
  });

  it("treats blank as clearing the field, not as an error", () => {
    expect(parseMoneyInput("")).toEqual({ value: null, error: null });
    expect(parseMoneyInput("   ")).toEqual({ value: null, error: null });
    expect(parseMoneyInput(null)).toEqual({ value: null, error: null });
  });

  it("refuses junk and negatives instead of storing null", () => {
    expect(parseMoneyInput("abc", "MRR").error).toMatch(/MRR must be a number/);
    expect(parseMoneyInput("12abc").error).not.toBeNull();
    expect(parseMoneyInput("0x10").error).not.toBeNull();
    expect(parseMoneyInput("-200", "Hourly rate").error).toMatch(/cannot be negative/);
    expect(parseMoneyInput(Number.NaN).error).not.toBeNull();
    expect(parseMoneyInput({}).error).not.toBeNull();
  });
});
