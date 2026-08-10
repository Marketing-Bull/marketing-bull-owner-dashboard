import { afterEach, describe, expect, it } from "vitest";
import { authorizeRequest, isLoopbackHost, isPublicPath, readBearerToken, tokensMatch } from "@/lib/auth";

/**
 * Cover for the access rules protecting `/api/state`, which reads and writes
 * MRR, goals, and client phone numbers.
 *
 * The failure that matters is fail-open: any case below that starts returning
 * `allowed: true` when it should not is a data leak, so the negative cases are
 * the point of this file.
 */

const originalToken = process.env.OWNER_DASHBOARD_AUTH_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.OWNER_DASHBOARD_AUTH_TOKEN;
  else process.env.OWNER_DASHBOARD_AUTH_TOKEN = originalToken;
});

function withToken(token: string | undefined) {
  if (token === undefined) delete process.env.OWNER_DASHBOARD_AUTH_TOKEN;
  else process.env.OWNER_DASHBOARD_AUTH_TOKEN = token;
}

describe("tokensMatch", () => {
  it("accepts only an exact match", () => {
    expect(tokensMatch("secret", "secret")).toBe(true);
    expect(tokensMatch("Secret", "secret")).toBe(false);
    expect(tokensMatch("secret ", "secret")).toBe(false);
  });

  it("rejects prefixes and extensions rather than comparing loosely", () => {
    expect(tokensMatch("sec", "secret")).toBe(false);
    expect(tokensMatch("secretsecret", "secret")).toBe(false);
    // Guards the modulo-indexing approach used for the constant-time compare:
    // a repeated candidate must not wrap around into a match.
    expect(tokensMatch("abab", "ab")).toBe(false);
  });

  it("rejects empty and missing candidates", () => {
    expect(tokensMatch("", "secret")).toBe(false);
    expect(tokensMatch(undefined, "secret")).toBe(false);
    expect(tokensMatch(null, "secret")).toBe(false);
  });
});

describe("isLoopbackHost", () => {
  it("recognises loopback hosts with and without a port", () => {
    for (const host of ["localhost", "localhost:3000", "127.0.0.1", "127.0.0.1:3018", "[::1]", "[::1]:3000"]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it("rejects everything else, including the LAN and tunnel cases", () => {
    for (const host of [
      "192.168.1.5:3000",
      "100.119.59.63:3018", // the Tailscale host this app is served from
      "amb-ubuntu-01.tail7a2140.ts.net:3018",
      "dashboard.example.com",
      "localhost.evil.com", // must not match on prefix
      "127.0.0.1.evil.com",
      "",
      null
    ]) {
      expect(isLoopbackHost(host), String(host)).toBe(false);
    }
  });
});

describe("authorizeRequest", () => {
  describe("with no token configured", () => {
    it("serves loopback callers", () => {
      withToken(undefined);
      expect(
        authorizeRequest({ host: "localhost:3000", cookieToken: undefined, bearerToken: undefined })
      ).toEqual({ allowed: true });
    });

    it("refuses everyone else so private data cannot leak to a LAN or tunnel", () => {
      withToken(undefined);
      for (const host of ["192.168.1.5:3000", "100.119.59.63:3018", "dash.example.com", null]) {
        expect(
          authorizeRequest({ host, cookieToken: undefined, bearerToken: undefined }),
          String(host)
        ).toEqual({ allowed: false, reason: "local-only" });
      }
    });

    it("ignores credentials supplied when none is configured", () => {
      withToken(undefined);
      expect(
        authorizeRequest({ host: "dash.example.com", cookieToken: "anything", bearerToken: "anything" })
      ).toEqual({ allowed: false, reason: "local-only" });
    });
  });

  describe("with a token configured", () => {
    it("accepts the cookie or the bearer header", () => {
      withToken("s3cret");
      expect(
        authorizeRequest({ host: "dash.example.com", cookieToken: "s3cret", bearerToken: undefined }).allowed
      ).toBe(true);
      expect(
        authorizeRequest({ host: "dash.example.com", cookieToken: undefined, bearerToken: "s3cret" }).allowed
      ).toBe(true);
    });

    it("refuses missing or wrong credentials", () => {
      withToken("s3cret");
      for (const credentials of [
        { cookieToken: undefined, bearerToken: undefined },
        { cookieToken: "wrong", bearerToken: undefined },
        { cookieToken: undefined, bearerToken: "wrong" },
        { cookieToken: "", bearerToken: "" }
      ]) {
        expect(authorizeRequest({ host: "dash.example.com", ...credentials })).toEqual({
          allowed: false,
          reason: "invalid-credentials"
        });
      }
    });

    it("still requires the token on loopback, so local is not a bypass", () => {
      withToken("s3cret");
      expect(
        authorizeRequest({ host: "localhost:3000", cookieToken: undefined, bearerToken: undefined }).allowed
      ).toBe(false);
    });

    it("treats a whitespace-only configured token as unset", () => {
      withToken("   ");
      expect(
        authorizeRequest({ host: "dash.example.com", cookieToken: undefined, bearerToken: undefined })
      ).toEqual({ allowed: false, reason: "local-only" });
    });
  });
});

describe("readBearerToken", () => {
  it("reads the token from a well-formed header, case-insensitively", () => {
    expect(readBearerToken("Bearer abc123")).toBe("abc123");
    expect(readBearerToken("bearer abc123")).toBe("abc123");
  });

  it("ignores other schemes and empty values", () => {
    expect(readBearerToken("Basic abc123")).toBeUndefined();
    expect(readBearerToken("Bearer")).toBeUndefined();
    expect(readBearerToken("Bearer   ")).toBeUndefined();
    expect(readBearerToken(null)).toBeUndefined();
  });
});

describe("isPublicPath", () => {
  it("exempts only what login and PWA install need", () => {
    for (const path of ["/login", "/api/login", "/sw.js", "/manifest.webmanifest", "/icon-192.png"]) {
      expect(isPublicPath(path), path).toBe(true);
    }
  });

  it("never exempts a private route", () => {
    for (const path of ["/", "/api/state", "/api/dashboard", "/api/calendar", "/login/../api/state"]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });
});
