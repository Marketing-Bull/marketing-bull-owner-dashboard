import { describe, expect, it } from "vitest";
import { createRouteCalcLock } from "@/lib/route-calc-lock";

describe("route calc lock", () => {
  it("locks only after success when fail unlocks a begun key", () => {
    const lock = createRouteCalcLock(["seed|pair"]);
    expect(lock.has("seed|pair")).toBe(true);
    expect(lock.begin("seed|pair")).toBe(false);

    expect(lock.begin("a|b")).toBe(true);
    expect(lock.begin("a|b")).toBe(false);
    lock.fail("a|b");
    expect(lock.has("a|b")).toBe(false);
    expect(lock.begin("a|b")).toBe(true);

    lock.succeed("a|b", "A Normalized|B Normalized");
    expect(lock.has("a|b")).toBe(true);
    expect(lock.has("A Normalized|B Normalized")).toBe(true);
    lock.fail("a|b");
    expect(lock.has("a|b")).toBe(false);
    expect(lock.has("A Normalized|B Normalized")).toBe(true);
  });

  it("clear forgets every pair, including the seeded one", () => {
    const lock = createRouteCalcLock(["seed|pair"]);
    lock.succeed("a|b", "A|B");
    lock.clear();
    expect(lock.has("seed|pair")).toBe(false);
    expect(lock.has("a|b")).toBe(false);
    expect(lock.has("A|B")).toBe(false);
    expect(lock.begin("seed|pair")).toBe(true);
    expect(lock.begin("seed|pair")).toBe(false);
  });
});
