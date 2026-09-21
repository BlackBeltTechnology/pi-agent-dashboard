import { beforeEach, describe, expect, it } from "vitest";
import { createCodeVerifier, createPkcePair, createRandomState, deriveCodeChallenge } from "../pkce.js";
import { clearAccessToken, getAccessToken, getExpiresAt, hasLiveToken, setAccessToken } from "../token-store.js";

const B64URL = /^[A-Za-z0-9\-_]+$/;

describe("PKCE (§12.1, RFC 7636)", () => {
  it("verifier is base64url within the 43–128 length window", () => {
    const v = createCodeVerifier();
    expect(v).toMatch(B64URL);
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
  });

  it("challenge is S256 base64url and deterministic for a verifier", async () => {
    const pair = await createPkcePair();
    expect(pair.method).toBe("S256");
    expect(pair.challenge).toMatch(B64URL);
    expect(pair.challenge).not.toContain("="); // no padding
    // Re-deriving the same verifier yields the same challenge.
    expect(await deriveCodeChallenge(pair.verifier)).toBe(pair.challenge);
  });

  it("matches the RFC 7636 Appendix B known-answer vector", async () => {
    // verifier and expected S256 challenge from RFC 7636 §B.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(await deriveCodeChallenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("verifiers and states are unique per call (entropy)", () => {
    expect(createCodeVerifier()).not.toBe(createCodeVerifier());
    expect(createRandomState()).not.toBe(createRandomState());
  });
});

describe("in-memory token store (§12.1)", () => {
  beforeEach(() => clearAccessToken());

  it("holds a live token and reports its expiry", () => {
    const t0 = Date.now();
    setAccessToken("tok-abc", 300);
    expect(getAccessToken()).toBe("tok-abc");
    expect(hasLiveToken()).toBe(true);
    expect(getExpiresAt()).toBeGreaterThanOrEqual(t0 + 300_000 - 50);
  });

  it("returns null once past expiry", () => {
    setAccessToken("tok-abc", 300);
    const past = Date.now() + 301_000;
    expect(getAccessToken(past)).toBeNull();
    expect(hasLiveToken(past)).toBe(false);
  });

  it("a non-positive lifetime is immediately expired", () => {
    setAccessToken("tok-abc", 0);
    expect(getAccessToken(Date.now() + 1)).toBeNull();
  });

  it("clear forgets the token", () => {
    setAccessToken("tok-abc", 300);
    clearAccessToken();
    expect(getAccessToken()).toBeNull();
    expect(getExpiresAt()).toBeNull();
  });

  it("is empty by default (no token, no expiry)", () => {
    expect(getAccessToken()).toBeNull();
    expect(getExpiresAt()).toBeNull();
    expect(hasLiveToken()).toBe(false);
  });
});
