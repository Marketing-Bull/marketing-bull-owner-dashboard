import { describe, expect, it } from "vitest";
import { guardRequest } from "@/lib/request-guard";

describe("request guard", () => {
  it("rejects cross-origin writes and permits same-origin or headerless scripts", () => {
    expect(guardRequest("POST", "/api/expenses", "dashboard.example", new Headers({
      Origin: "https://evil.example",
      "Sec-Fetch-Site": "cross-site"
    }), "dashboard.example")).toMatchObject({ allowed: false, status: 403 });
    expect(guardRequest("POST", "/api/expenses", "dashboard.example", new Headers({
      Origin: "https://dashboard.example",
      "Sec-Fetch-Site": "same-origin"
    }), "dashboard.example")).toEqual({ allowed: true });
    expect(guardRequest("POST", "/api/expenses", "dashboard.example", new Headers(), "dashboard.example")).toEqual({ allowed: true });
  });

  it("rejects unlisted hosts while accepting allowed hostnames with ports", () => {
    expect(guardRequest("GET", "/api/clients", "attacker.example", new Headers(), "dashboard.example"))
      .toMatchObject({ allowed: false, status: 421 });
    expect(guardRequest("GET", "/api/clients", "dashboard.example:3018", new Headers(), "dashboard.example"))
      .toEqual({ allowed: true });
    expect(guardRequest("GET", "/api/clients", "dashboard.example:3019", new Headers(), "dashboard.example:3018"))
      .toMatchObject({ allowed: false, status: 421 });
  });
});
