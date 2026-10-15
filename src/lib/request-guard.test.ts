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

  it("serves both live Tailscale addresses without any configuration", () => {
    for (const host of ["100.119.59.63:3018", "amb-ubuntu-01.tail7a2140.ts.net:3018", "localhost:3018"]) {
      expect(guardRequest("GET", "/", host, new Headers(), "")).toEqual({ allowed: true });
    }
    expect(guardRequest("GET", "/", "amb-ubuntu-01.tail7a2140.ts.net:3019", new Headers(), ""))
      .toMatchObject({ allowed: false, status: 421 });
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
