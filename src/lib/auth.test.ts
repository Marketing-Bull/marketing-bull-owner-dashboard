import { afterEach, describe, expect, it } from "vitest";
import {
  allowUnprotected,
  authFailureMessage,
  authorizeRequest,
  isAuthConfigured,
  isPublicPath,
  readBearerToken,
  tokensMatch
} from "@/lib/auth";

/**
 * Cover for the access rules protecting `/api/state`, which reads and writes
 * MRR, goals, and client phone numbers.
 *
 * Two directions can fail here and both matter. With a token configured, any
 * case starting to return `allowed: true` without valid credentials is a data
 * leak. With no token configured, the default is now LOCKED — an unset
 * deployment quietly serving everything again is the regression phase 1
 * exists to prevent — and running open requires the explicit opt-out.
 */

const originalToken = process.env.OWNER_DASHBOARD_AUTH_TOKEN;
const originalOptOut = process.env.OWNER_DASHBOARD_ALLOW_UNPROTECTED;

afterEach(() => {
  if (originalToken === undefined) delete process.env.OWNER_DASHBOARD_AUTH_TOKEN;
  else process.env.OWNER_DASHBOARD_AUTH_TOKEN = originalToken;
  if (originalOptOut === undefined) delete process.env.OWNER_DASHBOARD_ALLOW_UNPROTECTED;
  else process.env.OWNER_DASHBOARD_ALLOW_UNPROTECTED = originalOptOut;
});

function withToken(token: string | undefined) {
  if (token === undefined) delete process.env.OWNER_DASHBOARD_AUTH_TOKEN;
  else process.env.OWNER_DASHBOARD_AUTH_TOKEN = token;
}

function withOptOut(value: string | undefined) {
  if (value === undefined) delete process.env.OWNER_DASHBOARD_ALLOW_UNPROTECTED;
  else process.env.OWNER_DASHBOARD_ALLOW_UNPROTECTED = value;
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

describe("allowUnprotected", () => {
  it("is off unless explicitly switched on", () => {
    withOptOut(undefined);
    expect(allowUnprotected()).toBe(false);
    withOptOut("");
    expect(allowUnprotected()).toBe(false);
    withOptOut("0");
    expect(allowUnprotected()).toBe(false);
    withOptOut("false");
    expect(allowUnprotected()).toBe(false);
  });

  it("accepts the usual truthy spellings", () => {
    for (const value of ["1", "true", "TRUE", "yes", " 1 "]) {
      withOptOut(value);
      expect(allowUnprotected(), value).toBe(true);
    }
  });
});

describe("authorizeRequest", () => {
  describe("with no token configured", () => {
    it("locks every request by default — there is nothing to sign in with", () => {
      withToken(undefined);
      withOptOut(undefined);
      expect(authorizeRequest({ cookieToken: undefined, bearerToken: undefined })).toEqual({
        allowed: false,
        reason: "not-configured"
      });
    });

    it("stays locked even if a stale cookie or bearer token is presented", () => {
      withToken(undefined);
      withOptOut(undefined);
      expect(
        authorizeRequest({ cookieToken: "left-over-cookie", bearerToken: "whatever" }).allowed
      ).toBe(false);
    });

    it("treats a whitespace-only token as unset", () => {
      withToken("   ");
      withOptOut(undefined);
      expect(authorizeRequest({ cookieToken: undefined, bearerToken: undefined })).toEqual({
        allowed: false,
        reason: "not-configured"
      });
    });

    it("opens only under the explicit opt-out", () => {
      withToken(undefined);
      withOptOut("1");
      expect(authorizeRequest({ cookieToken: undefined, bearerToken: undefined })).toEqual({
        allowed: true
      });
    });

    it("describes the locked state as setup, not as bad credentials", () => {
      expect(authFailureMessage("not-configured")).toMatch(/OWNER_DASHBOARD_AUTH_TOKEN/);
      expect(authFailureMessage("invalid-credentials")).toBe("Authentication required.");
    });
  });

  describe("with a token configured, opt-out must be irrelevant", () => {
    it("still requires credentials even if the opt-out is set", () => {
      withToken("s3cret");
      withOptOut("1");
      expect(authorizeRequest({ cookieToken: undefined, bearerToken: undefined })).toEqual({
        allowed: false,
        reason: "invalid-credentials"
      });
      expect(authorizeRequest({ cookieToken: "s3cret", bearerToken: undefined }).allowed).toBe(true);
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
