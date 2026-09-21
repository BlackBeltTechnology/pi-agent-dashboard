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
