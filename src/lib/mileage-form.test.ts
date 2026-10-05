import { describe, expect, it } from "vitest";
import { milesAfterAddressChange, staleMilesHint } from "@/lib/mileage-form";

describe("mileage address edits", () => {
  it("clears provider-calculated miles when an address changes", () => {
    expect(milesAfterAddressChange({ miles: "12.4", calculationSource: "provider" })).toEqual({ miles: "", stale: "cleared" });
  });

  it("keeps manually typed miles but flags them stale", () => {
    expect(milesAfterAddressChange({ miles: "12.4", calculationSource: "manual" })).toEqual({ miles: "12.4", stale: "kept" });
  });

  it("leaves empty miles alone and keeps the prior stale state", () => {
    expect(milesAfterAddressChange({ miles: "", calculationSource: "manual" })).toEqual({ miles: "", stale: null });
    expect(milesAfterAddressChange({ miles: "", calculationSource: "manual" }, "cleared")).toEqual({ miles: "", stale: "cleared" });
    expect(milesAfterAddressChange({ miles: "", calculationSource: "provider" }, "cleared")).toEqual({ miles: "", stale: "cleared" });
  });

  it("words the hint for with and without Maps", () => {
    expect(staleMilesHint(null, true)).toBeNull();
    expect(staleMilesHint("cleared", true)).toMatch(/recalculate/);
    expect(staleMilesHint("cleared", false)).toMatch(/Enter miles manually/);
    expect(staleMilesHint("kept", false)).toMatch(/double-check/);
  });
});
