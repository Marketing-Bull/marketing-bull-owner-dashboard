import { afterEach, describe, expect, it } from "vitest";
import { authorizeRequest, isAuthConfigured, isPublicPath, readBearerToken, tokensMatch } from "@/lib/auth";

/**
 * Cover for the access rules protecting `/api/state`, which reads and writes
 * MRR, goals, and client phone numbers.
 *
 * With no token configured the dashboard is deliberately open, so the cases
 * that matter here are the configured ones: any of them starting to return
 * `allowed: true` without valid credentials is a data leak.
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

describe("isAuthConfigured", () => {
  it("reports whether a token is set, which is what the UI warns on", () => {
    withToken(undefined);
    expect(isAuthConfigured()).toBe(false);
    withToken("   ");
    expect(isAuthConfigured()).toBe(false);
    withToken("s3cret");
    expect(isAuthConfigured()).toBe(true);
  });
});

describe("authorizeRequest", () => {
  describe("with no token configured", () => {
    it("lets every request through, since there is nothing to sign in with", () => {
      withToken(undefined);
      expect(
        authorizeRequest({ cookieToken: undefined, bearerToken: undefined })
      ).toEqual({ allowed: true });
    });

    it("treats a whitespace-only token as unset", () => {
      withToken("   ");
      expect(authorizeRequest({ cookieToken: undefined, bearerToken: undefined }).allowed).toBe(true);
    });
  });

  describe("with a token configured", () => {
    it("accepts the cookie or the bearer header", () => {
      withToken("s3cret");
      expect(authorizeRequest({ cookieToken: "s3cret", bearerToken: undefined }).allowed).toBe(true);
      expect(authorizeRequest({ cookieToken: undefined, bearerToken: "s3cret" }).allowed).toBe(true);
    });

    it("refuses missing or wrong credentials", () => {
      withToken("s3cret");
      for (const credentials of [
        { cookieToken: undefined, bearerToken: undefined },
        { cookieToken: "wrong", bearerToken: undefined },
        { cookieToken: undefined, bearerToken: "wrong" },
        { cookieToken: "", bearerToken: "" }
      ]) {
        expect(authorizeRequest(credentials)).toEqual({
          allowed: false,
          reason: "invalid-credentials"
        });
      }
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
