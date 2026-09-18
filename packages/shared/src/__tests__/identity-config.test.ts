import { describe, expect, it } from "vitest";
import { DEFAULT_IDENTITY, parseIdentityConfig } from "../config.js";

describe("parseIdentityConfig", () => {
  it("defaults to inert (empty trust list, no policy) when absent", () => {
    for (const raw of [undefined, null, {}, 42, "x", []]) {
      const c = parseIdentityConfig(raw as any);
      expect(c.trustedResolverPlugins).toEqual([]);
      expect(c.trustedPolicyPlugin).toBeUndefined();
      expect(c.resolverTimeoutMs).toBe(DEFAULT_IDENTITY.resolverTimeoutMs);
      expect(c.policyTimeoutMs).toBe(DEFAULT_IDENTITY.policyTimeoutMs);
    }
  });

  it("keeps only non-empty string resolver plugin ids", () => {
    const c = parseIdentityConfig({
      trustedResolverPlugins: ["a", "", 3, null, "b"],
    });
    expect(c.trustedResolverPlugins).toEqual(["a", "b"]);
  });

  it("adopts a named policy plugin only when a non-empty string", () => {
    expect(parseIdentityConfig({ trustedPolicyPlugin: "invoicebot" }).trustedPolicyPlugin).toBe(
      "invoicebot",
    );
    expect(parseIdentityConfig({ trustedPolicyPlugin: "" }).trustedPolicyPlugin).toBeUndefined();
    expect(parseIdentityConfig({ trustedPolicyPlugin: 7 as any }).trustedPolicyPlugin).toBeUndefined();
  });

  it("clamps timeouts into their ranges and falls back on garbage", () => {
    expect(parseIdentityConfig({ resolverTimeoutMs: 50 }).resolverTimeoutMs).toBe(100); // min 100
    expect(parseIdentityConfig({ resolverTimeoutMs: 99999 }).resolverTimeoutMs).toBe(5000); // max 5000
    expect(parseIdentityConfig({ resolverTimeoutMs: "x" as any }).resolverTimeoutMs).toBe(2000);
    expect(parseIdentityConfig({ policyTimeoutMs: 10 }).policyTimeoutMs).toBe(50); // min 50
    expect(parseIdentityConfig({ policyTimeoutMs: 99999 }).policyTimeoutMs).toBe(2000); // max 2000
    expect(parseIdentityConfig({ policyTimeoutMs: NaN }).policyTimeoutMs).toBe(500);
  });
});
