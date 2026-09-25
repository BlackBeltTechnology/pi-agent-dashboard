import { describe, expect, it } from "vitest";
import { type IdentityEnforcementInput, identityDisarmedWarning, isIdentityEnforced } from "../activation.js";

/** Fully configured: resolver active, login provider registered, no conflict, no policy named. */
const armed: IdentityEnforcementInput = {
  resolverActive: true,
  loginProviderRegistered: true,
  legacyConnectorsActive: false,
  trustedPolicyPlugin: undefined,
  registeredPolicyCount: 0,
};
const inert: IdentityEnforcementInput = { ...armed, resolverActive: false, loginProviderRegistered: false };

describe("isIdentityEnforced — self-lockout guard (D21)", () => {
  it("enforces only when fully configured", () => {
    expect(isIdentityEnforced(armed)).toBe(true);
  });
  it("inert when no resolver is active", () => {
    expect(isIdentityEnforced(inert)).toBe(false);
    expect(isIdentityEnforced({ ...armed, resolverActive: false })).toBe(false);
  });
  it("stays INERT when a resolver is active but no login provider is registered", () => {
    expect(isIdentityEnforced({ ...armed, loginProviderRegistered: false })).toBe(false);
  });
  it("D8: MOUNTED legacy cookie connectors disarm instead of failing startup", () => {
    expect(isIdentityEnforced({ ...armed, legacyConnectorsActive: true })).toBe(false);
  });
  it("D9: a named-but-absent trusted policy disarms instead of failing startup", () => {
    expect(isIdentityEnforced({ ...armed, trustedPolicyPlugin: "invoicebot", registeredPolicyCount: 0 })).toBe(false);
  });
  it("D9: a duplicate trusted policy disarms instead of choosing one", () => {
    expect(isIdentityEnforced({ ...armed, trustedPolicyPlugin: "invoicebot", registeredPolicyCount: 2 })).toBe(false);
  });
  it("D9: exactly one registered policy for the named id stays armed", () => {
    expect(isIdentityEnforced({ ...armed, trustedPolicyPlugin: "invoicebot", registeredPolicyCount: 1 })).toBe(true);
  });
});

describe("identityDisarmedWarning (D21)", () => {
  it("is silent when inert by choice or fully armed", () => {
    expect(identityDisarmedWarning(inert)).toBeNull();
    expect(identityDisarmedWarning(armed)).toBeNull();
  });
  it("names a missing login provider", () => {
    const w = identityDisarmedWarning({ ...armed, loginProviderRegistered: false });
    expect(w).toMatch(/NOT enforced/);
    expect(w).toMatch(/no login provider/);
  });
  it("names a login provider without an active resolver", () => {
    expect(identityDisarmedWarning({ ...armed, resolverActive: false })).toMatch(/no principal resolver is active/);
  });
  it("names the auth.providers conflict", () => {
    expect(identityDisarmedWarning({ ...armed, legacyConnectorsActive: true })).toMatch(/auth\.providers/);
  });
  it("names a misregistered trusted policy even while otherwise inert", () => {
    const w = identityDisarmedWarning({ ...inert, trustedPolicyPlugin: "invoicebot", registeredPolicyCount: 0 });
    expect(w).toMatch(/trustedPolicyPlugin 'invoicebot'/);
  });
  it("lists every reason at once", () => {
    const w = identityDisarmedWarning({
      ...armed,
      loginProviderRegistered: false,
      legacyConnectorsActive: true,
      trustedPolicyPlugin: "p",
      registeredPolicyCount: 2,
    });
    expect(w).toMatch(/no login provider/);
    expect(w).toMatch(/auth\.providers/);
    expect(w).toMatch(/trustedPolicyPlugin 'p'/);
  });
});
