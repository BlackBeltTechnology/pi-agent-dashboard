import { describe, expect, it } from "vitest";
import { assertIdentityReadiness, IdentityStartupError } from "../activation.js";

const base = {
  resolverActive: false,
  trustedPolicyPlugin: undefined as string | undefined,
  registeredPolicyCount: 0,
  authProviderCount: 0,
};

describe("assertIdentityReadiness — policy plugin (§2.2 / D9)", () => {
  it("inert happy path: no policy named, nothing registered → ok", () => {
    expect(() => assertIdentityReadiness({ ...base })).not.toThrow();
  });

  it("named-but-absent policy fails startup", () => {
    expect(() =>
      assertIdentityReadiness({ ...base, trustedPolicyPlugin: "invoicebot", registeredPolicyCount: 0 }),
    ).toThrow(IdentityStartupError);
  });

  it("duplicate policy registration fails startup", () => {
    expect(() =>
      assertIdentityReadiness({ ...base, trustedPolicyPlugin: "invoicebot", registeredPolicyCount: 2 }),
    ).toThrow(IdentityStartupError);
  });

  it("exactly one registered policy for the named id is ok", () => {
    expect(() =>
      assertIdentityReadiness({ ...base, trustedPolicyPlugin: "invoicebot", registeredPolicyCount: 1 }),
    ).not.toThrow();
  });
});

describe("assertIdentityReadiness — connector exclusion (§2.3 / D8)", () => {
  it("active resolver + confidential connectors fails startup", () => {
    expect(() => assertIdentityReadiness({ ...base, resolverActive: true, authProviderCount: 1 })).toThrow(
      IdentityStartupError,
    );
  });

  it("inert dashboard leaves connectors intact", () => {
    expect(() =>
      assertIdentityReadiness({ ...base, resolverActive: false, authProviderCount: 3 }),
    ).not.toThrow();
  });

  it("active resolver with no connectors is ok", () => {
    expect(() =>
      assertIdentityReadiness({ ...base, resolverActive: true, authProviderCount: 0 }),
    ).not.toThrow();
  });
});
