/**
 * The "Website by Marketing Bull" credit in the sidebar footer.
 *
 * The UTM tags let Marketing Bull's analytics attribute the visit to this
 * dashboard. The values are fixed strings, so the link is the same on every
 * page and in every environment.
 */

export const WEBSITE_CREDIT_TEXT = "Website by Marketing Bull";

const WEBSITE_URL = "https://getmarketingbull.com";

export const WEBSITE_CREDIT_URL = `${WEBSITE_URL}/?${new URLSearchParams({
  utm_source: "owner-dashboard",
  utm_medium: "referral",
  utm_campaign: "website-by-marketing-bull"
}).toString()}`;
