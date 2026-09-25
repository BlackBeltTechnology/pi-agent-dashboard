import type React from "react";
import { describe, expect, it } from "vitest";
import { type LoginRegistryEntry, safeReturnTo, selectLoginProvider } from "../gate.js";

const ORIGIN = "https://dash.example";

describe("safeReturnTo (open-redirect + recursion defence, F1/H6, LG-12/LG-17)", () => {
  it("accepts a same-origin deep link, preserving query + hash", () => {
    expect(safeReturnTo("/session/abc", ORIGIN)).toBe("/session/abc");
    expect(safeReturnTo("/session/abc?tab=diff#top", ORIGIN)).toBe("/session/abc?tab=diff#top");
  });

  it("rejects absolute, scheme-relative, and backslash hosts → '/'", () => {
    expect(safeReturnTo("https://evil.example/x", ORIGIN)).toBe("/");
    expect(safeReturnTo("//evil.com", ORIGIN)).toBe("/");
    expect(safeReturnTo("/\\evil.com", ORIGIN)).toBe("/");
    expect(safeReturnTo("http://evil", ORIGIN)).toBe("/");
  });

  it("rejects callback recursion and the dead legacy login banner → '/'", () => {
    expect(safeReturnTo("/callback", ORIGIN)).toBe("/");
    expect(safeReturnTo("/callback?code=x", ORIGIN)).toBe("/");
    expect(safeReturnTo("/auth/login", ORIGIN)).toBe("/");
  });

  it("empty / null / garbage → '/'", () => {
    expect(safeReturnTo(null, ORIGIN)).toBe("/");
    expect(safeReturnTo(undefined, ORIGIN)).toBe("/");
    expect(safeReturnTo("", ORIGIN)).toBe("/");
  });
});

// A fake component sentinel per plugin — identity is all the selector asserts.
const A = (() => null) as unknown as React.ComponentType<unknown>;
const B = (() => null) as unknown as React.ComponentType<unknown>;
const UNTRUSTED = (() => null) as unknown as React.ComponentType<unknown>;

function entry(id: string, Component: React.ComponentType<unknown> | undefined): LoginRegistryEntry {
  return {
    manifest: { id },
    claims: Component ? [{ slot: "login-provider", pluginId: id, Component }] : [],
  };
}

const enableAll = () => true;

describe("selectLoginProvider (trust-bound, by pluginId, B3/F6, LG-5/LG-7/LG-17)", () => {
  it("returns null when login is inactive (no configPluginId)", () => {
    expect(
      selectLoginProvider({ registry: [entry("keycloak-resolver", A)], configPluginId: undefined, isEnabled: enableAll }),
    ).toBeNull();
  });

  it("selects the provider whose pluginId matches the host-vouched id (LG-17/LG-22)", () => {
    const registry = [entry("resolver-a", A), entry("resolver-b", B)];
    expect(selectLoginProvider({ registry, configPluginId: "resolver-a", isEnabled: enableAll })).toBe(A);
    expect(selectLoginProvider({ registry, configPluginId: "resolver-b", isEnabled: enableAll })).toBe(B);
  });

  it("never selects an untrusted higher-priority claimant — only the vouched id (LG-5)", () => {
    // The untrusted plugin also claims login-provider, but the host returned the
    // trusted id; selection matches that id, so the untrusted component is inert.
    const registry = [entry("untrusted-hijacker", UNTRUSTED), entry("keycloak-resolver", A)];
    expect(selectLoginProvider({ registry, configPluginId: "keycloak-resolver", isEnabled: enableAll })).toBe(A);
  });

  it("returns null when the owning plugin is disabled (enable-filter, B5/LG-7)", () => {
    const registry = [entry("keycloak-resolver", A)];
    const isEnabled = (id: string) => id !== "keycloak-resolver";
    expect(selectLoginProvider({ registry, configPluginId: "keycloak-resolver", isEnabled })).toBeNull();
  });

  it("returns null when the owning plugin is absent or unclaimed", () => {
    expect(
      selectLoginProvider({ registry: [entry("other", A)], configPluginId: "keycloak-resolver", isEnabled: enableAll }),
    ).toBeNull();
    expect(
      selectLoginProvider({ registry: [entry("keycloak-resolver", undefined)], configPluginId: "keycloak-resolver", isEnabled: enableAll }),
    ).toBeNull();
  });
});

// ── D19: separate-view (URL) provider dispatch ───────────────────────────────
import { providerRedirect, resolveGateRedirect } from "../gate.js";

describe("providerRedirect (separate-view provider safety, D19)", () => {
  it("accepts a same-origin path, preserving query + hash", () => {
    expect(providerRedirect("/identity-smoke/login", ORIGIN)).toBe("/identity-smoke/login");
    expect(providerRedirect("/sso?next=/x#f", ORIGIN)).toBe("/sso?next=/x#f");
  });

  it("rejects absolute, scheme-relative, and backslash hosts (open redirect)", () => {
    expect(providerRedirect("https://evil.example/x", ORIGIN)).toBeNull();
    expect(providerRedirect("//evil.com", ORIGIN)).toBeNull();
    expect(providerRedirect("/\\evil.com", ORIGIN)).toBeNull();
    expect(providerRedirect("http://evil", ORIGIN)).toBeNull();
  });

  it("rejects core's own gate routes so a redirect cannot loop", () => {
    expect(providerRedirect("/callback", ORIGIN)).toBeNull();
    expect(providerRedirect("/logout", ORIGIN)).toBeNull();
  });

  it("empty / absent → null (caller falls back to the component path)", () => {
    expect(providerRedirect(undefined, ORIGIN)).toBeNull();
    expect(providerRedirect("", ORIGIN)).toBeNull();
  });
});

describe("resolveGateRedirect (per-phase dispatch, D19)", () => {
  it("start phase uses loginUrl", () => {
    expect(resolveGateRedirect("start", { loginUrl: "/sso/login" }, ORIGIN)).toBe("/sso/login");
  });

  it("logout phase uses logoutUrl", () => {
    expect(resolveGateRedirect("logout", { logoutUrl: "/sso/logout" }, ORIGIN)).toBe("/sso/logout");
  });

  it("callback phase recovers to loginUrl (core owns no callback for a URL provider)", () => {
    expect(resolveGateRedirect("callback", { loginUrl: "/sso/login" }, ORIGIN)).toBe("/sso/login");
  });

  it("logout does NOT fall back to loginUrl (sign-out must not sign back in)", () => {
    expect(resolveGateRedirect("logout", { loginUrl: "/sso/login" }, ORIGIN)).toBeNull();
  });

  it("no URLs configured → null (component provider path)", () => {
    expect(resolveGateRedirect("start", {}, ORIGIN)).toBeNull();
    expect(resolveGateRedirect("logout", {}, ORIGIN)).toBeNull();
  });
});
