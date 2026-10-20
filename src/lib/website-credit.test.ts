import { describe, expect, it } from "vitest";
import { WEBSITE_CREDIT_TEXT, WEBSITE_CREDIT_URL } from "@/lib/website-credit";

describe("website credit link", () => {
  it("says what the owner asked for", () => {
    expect(WEBSITE_CREDIT_TEXT).toBe("Website by Marketing Bull");
  });

  it("points at the Marketing Bull site with UTM tags", () => {
    const url = new URL(WEBSITE_CREDIT_URL);
    expect(url.origin).toBe("https://getmarketingbull.com");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      utm_source: "owner-dashboard",
      utm_medium: "referral",
      utm_campaign: "website-by-marketing-bull"
    });
  });
});
