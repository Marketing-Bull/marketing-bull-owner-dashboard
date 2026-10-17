import { describe, expect, it } from "vitest";
import { billableZeroRateHint } from "@/lib/time-form";

describe("billableZeroRateHint", () => {
  it("warns when billable and rate is zero", () => {
    expect(billableZeroRateHint(true, 0)).toMatch(/Billable at \$0/);
    expect(billableZeroRateHint(true, 0)).toMatch(/won't add revenue/);
  });

  it("treats negative rates the same as zero for the soft warning", () => {
    // Schema clamps rate >= 0, but defend the UI condition.
    expect(billableZeroRateHint(true, -1)).not.toBeNull();
  });

  it("stays quiet when not billable or when a positive rate is set", () => {
    expect(billableZeroRateHint(false, 0)).toBeNull();
    expect(billableZeroRateHint(true, 150)).toBeNull();
    expect(billableZeroRateHint(false, 150)).toBeNull();
  });
});
