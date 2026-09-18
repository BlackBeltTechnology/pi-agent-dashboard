import { describe, expect, it } from "vitest";
import { sanitizePrincipalResolution } from "../principal-guard.js";

const NOW = 1_700_000_000_000;
const SKEW = 30;
const future = NOW + 60_000;

describe("sanitizePrincipalResolution — validate/copy/freeze (§3.3 / D3)", () => {
  it("accepts a well-formed resolution and returns a frozen copy", () => {
    const raw = { principal: { iss: "https://kc", sub: "u1", email: "a@b.c" }, expiresAt: future };
    const out = sanitizePrincipalResolution(raw, SKEW, NOW);
    expect(out).not.toBeNull();
    expect(out?.principal).toEqual({ iss: "https://kc", sub: "u1", email: "a@b.c" });
    expect(out?.expiresAt).toBe(future);
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out?.principal)).toBe(true);
  });

  it("does not carry extra enumerable props from the resolver output", () => {
    const raw = {
      principal: { iss: "https://kc", sub: "u1", role: "admin" },
      expiresAt: future,
      extra: "nope",
    };
    const out = sanitizePrincipalResolution(raw, SKEW, NOW);
    expect(Object.keys(out ?? {})).toEqual(["principal", "expiresAt"]);
    expect(Object.keys(out?.principal ?? {})).toEqual(["iss", "sub"]);
    expect((out as Record<string, unknown> | null)?.extra).toBeUndefined();
  });

  it("rejects a non-string display label", () => {
    const out = sanitizePrincipalResolution(
      { principal: { iss: "i", sub: "s", email: 42 }, expiresAt: future },
      SKEW,
      NOW,
    );
    expect(out).toBeNull();
  });

  it("rejects empty or whitespace-only iss/sub", () => {
    expect(sanitizePrincipalResolution({ principal: { iss: "", sub: "s" }, expiresAt: future }, SKEW, NOW)).toBeNull();
    expect(sanitizePrincipalResolution({ principal: { iss: "i", sub: "" }, expiresAt: future }, SKEW, NOW)).toBeNull();
    expect(sanitizePrincipalResolution({ principal: { iss: "   ", sub: "s" }, expiresAt: future }, SKEW, NOW)).toBeNull();
  });

  it("rejects non-plain objects and never executes getters/proxy traps past the guard", () => {
    class PrincipalClass {
      iss = "i";
      sub = "s";
    }
    expect(
      sanitizePrincipalResolution({ principal: new PrincipalClass(), expiresAt: future }, SKEW, NOW),
    ).toBeNull();

    let getterRan = false;
    const principal = Object.defineProperty({}, "iss", {
      get() {
        getterRan = true;
        throw new Error("getter must not run");
      },
    });
    Object.assign(principal, { sub: "s" });
    expect(sanitizePrincipalResolution({ principal, expiresAt: future }, SKEW, NOW)).toBeNull();
    expect(getterRan).toBe(false);

    const hostile = new Proxy({}, { getPrototypeOf: () => { throw new Error("trap"); } });
    expect(sanitizePrincipalResolution(hostile, SKEW, NOW)).toBeNull();
  });

  it("rejects over-length fields", () => {
    const long = "x".repeat(5000);
    expect(sanitizePrincipalResolution({ principal: { iss: long, sub: "s" }, expiresAt: future }, SKEW, NOW)).toBeNull();
  });

  it("rejects a non-future / non-finite expiresAt but forgives within skew", () => {
    expect(sanitizePrincipalResolution({ principal: { iss: "i", sub: "s" }, expiresAt: NOW - 60_000 }, SKEW, NOW)).toBeNull();
    expect(sanitizePrincipalResolution({ principal: { iss: "i", sub: "s" }, expiresAt: Number.NaN }, SKEW, NOW)).toBeNull();
    // within skew (10s before now, skew 30s) → still accepted
    expect(sanitizePrincipalResolution({ principal: { iss: "i", sub: "s" }, expiresAt: NOW - 10_000 }, SKEW, NOW)).not.toBeNull();
  });

  it("rejects non-object / missing principal", () => {
    expect(sanitizePrincipalResolution(null, SKEW, NOW)).toBeNull();
    expect(sanitizePrincipalResolution({ expiresAt: future }, SKEW, NOW)).toBeNull();
    expect(sanitizePrincipalResolution({ principal: "x", expiresAt: future }, SKEW, NOW)).toBeNull();
  });
});
