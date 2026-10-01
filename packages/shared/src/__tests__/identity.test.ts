import { describe, expect, it } from "vitest";
import {
  isPrincipalResolution,
  isResolverReject,
  principalEquals,
  type ResolverOutcome,
} from "../identity.js";

describe("identity outcome guards", () => {
  const resolution: ResolverOutcome = {
    principal: { iss: "https://kc/realms/r", sub: "abc" },
    expiresAt: Date.now() + 60_000,
  };
  const reject: ResolverOutcome = { reject: true, reason: "bad sig" };

  it("distinguishes the three outcomes", () => {
    expect(isPrincipalResolution(resolution)).toBe(true);
    expect(isResolverReject(resolution)).toBe(false);

    expect(isResolverReject(reject)).toBe(true);
    expect(isPrincipalResolution(reject)).toBe(false);

    expect(isPrincipalResolution(null)).toBe(false);
    expect(isResolverReject(null)).toBe(false);
  });
});

describe("principalEquals", () => {
  it("is exact on (iss, sub) with no normalization", () => {
    const a = { iss: "https://kc/realms/r", sub: "u1" };
    expect(principalEquals(a, { iss: "https://kc/realms/r", sub: "u1" })).toBe(true);
    // sub case differs → not equal
    expect(principalEquals(a, { iss: "https://kc/realms/r", sub: "U1" })).toBe(false);
    // iss differs → not equal
    expect(principalEquals(a, { iss: "https://kc/realms/other", sub: "u1" })).toBe(false);
  });

  it("treats null/undefined as never equal (ownerless is not a match)", () => {
    const a = { iss: "i", sub: "s" };
    expect(principalEquals(a, null)).toBe(false);
    expect(principalEquals(null, a)).toBe(false);
    expect(principalEquals(null, null)).toBe(false);
    expect(principalEquals(undefined, undefined)).toBe(false);
  });
});
