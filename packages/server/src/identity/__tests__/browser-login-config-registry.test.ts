import { describe, expect, it } from "vitest";
import { BrowserLoginConfigRegistry } from "../browser-login-config-registry.js";

describe("BrowserLoginConfigRegistry (D16 host login-config seam)", () => {
  const cfg = { pluginId: "keycloak-resolver", issuer: "https://kc.example/realms/pi", clientId: "dashboard-web" };

  it("starts empty — no trusted resolver has published a descriptor (LG-2)", () => {
    expect(new BrowserLoginConfigRegistry().get()).toBeNull();
  });

  it("relays the published descriptor verbatim (LG-1)", () => {
    const r = new BrowserLoginConfigRegistry();
    r.set(cfg);
    expect(r.get()).toEqual(cfg);
  });

  it("last registration wins and carries its owning pluginId (F6)", () => {
    const r = new BrowserLoginConfigRegistry();
    r.set(cfg);
    const b = { pluginId: "other-resolver", issuer: "https://b.example", clientId: "b-web" };
    r.set(b);
    expect(r.get()).toEqual(b);
    expect(r.get()?.pluginId).toBe("other-resolver");
  });

  it("unregister clears only if still current (idempotent)", () => {
    const r = new BrowserLoginConfigRegistry();
    const off = r.set(cfg);
    const b = { pluginId: "other", issuer: "https://b", clientId: "b" };
    r.set(b);
    off(); // stale handle — must NOT clear the newer descriptor
    expect(r.get()).toEqual(b);
  });
});

// ── D19: adapter validation at the host trust boundary ──────────────────────
import { sanitizeBrowserLoginConfig } from "../browser-login-config-registry.js";

describe("sanitizeBrowserLoginConfig (D19 host boundary)", () => {
  it("accepts a COMPONENT provider (issuer + clientId)", () => {
    expect(sanitizeBrowserLoginConfig({ issuer: "https://kc.example/realms/pi", clientId: "web" })).toEqual({
      issuer: "https://kc.example/realms/pi",
      clientId: "web",
    });
  });

  it("accepts a SEPARATE-VIEW provider (loginUrl only, no OIDC fields)", () => {
    expect(sanitizeBrowserLoginConfig({ loginUrl: "/identity-smoke/login", logoutUrl: "/identity-smoke/logout" })).toEqual({
      loginUrl: "/identity-smoke/login",
      logoutUrl: "/identity-smoke/logout",
    });
  });

  it("drops off-origin / scheme-relative / non-path URLs (open-redirect defence)", () => {
    expect(sanitizeBrowserLoginConfig({ loginUrl: "https://evil.example/x" })).toBeNull();
    expect(sanitizeBrowserLoginConfig({ loginUrl: "//evil.example/x" })).toBeNull();
    expect(sanitizeBrowserLoginConfig({ loginUrl: "identity-smoke/login" })).toBeNull();
    // An unsafe logoutUrl is dropped while a safe loginUrl keeps the descriptor usable.
    expect(sanitizeBrowserLoginConfig({ loginUrl: "/sso/login", logoutUrl: "https://evil.example/out" })).toEqual({
      loginUrl: "/sso/login",
    });
  });

  it("rejects core's own gate routes (redirect loop)", () => {
    expect(sanitizeBrowserLoginConfig({ loginUrl: "/logout" })).toBeNull();
  });

  it("rejects a descriptor with no usable provider kind", () => {
    expect(sanitizeBrowserLoginConfig({})).toBeNull();
    expect(sanitizeBrowserLoginConfig({ issuer: "https://kc.example" })).toBeNull();
    expect(sanitizeBrowserLoginConfig({ clientId: "web" })).toBeNull();
  });

  it("ignores unknown fields (never forwards them to the browser)", () => {
    expect(sanitizeBrowserLoginConfig({ loginUrl: "/sso/login", evil: "x" } as never)).toEqual({ loginUrl: "/sso/login" });
  });
});
