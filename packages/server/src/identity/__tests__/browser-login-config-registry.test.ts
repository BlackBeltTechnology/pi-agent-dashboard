import { describe, expect, it } from "vitest";
import { BrowserLoginConfigRegistry, publicLoginConfig } from "../browser-login-config-registry.js";

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

  it("holds EVERY trusted provider, in registration order; get() is the first (D25)", () => {
    const r = new BrowserLoginConfigRegistry();
    r.set(cfg);
    const b = { pluginId: "github-login", loginUrl: "/gh/start", label: "GitHub" };
    r.set(b);
    expect(r.list()).toEqual([cfg, b]);
    expect(r.get()).toEqual(cfg);
  });

  it("a plugin re-registering replaces only its own entry", () => {
    const r = new BrowserLoginConfigRegistry();
    r.set(cfg);
    r.set({ pluginId: "github-login", loginUrl: "/gh/start" });
    const cfg2 = { ...cfg, clientId: "dashboard-web-2" };
    r.set(cfg2);
    expect(r.list().map((d) => d.pluginId)).toEqual(["keycloak-resolver", "github-login"]);
    expect(r.list()[0]).toEqual(cfg2);
  });

  it("unregister removes only its own, still-current entry (idempotent)", () => {
    const r = new BrowserLoginConfigRegistry();
    const offA = r.set(cfg);
    const offStale = r.set({ pluginId: "github-login", loginUrl: "/gh/a" });
    r.set({ pluginId: "github-login", loginUrl: "/gh/b" });
    offStale(); // stale handle — must NOT clear the newer github entry
    expect(r.list().map((d) => d.loginUrl ?? d.pluginId)).toEqual(["keycloak-resolver", "/gh/b"]);
    offA();
    offA();
    expect(r.list().map((d) => d.pluginId)).toEqual(["github-login"]);
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

  it("keeps the D22 dashboard-UI fields: tokenUrl + postLogoutUrl (same-origin paths), label, endsProviderSession", () => {
    expect(
      sanitizeBrowserLoginConfig({
        loginUrl: "/idl/start",
        logoutUrl: "/idl/logout",
        tokenUrl: "/idl/token",
        postLogoutUrl: "/?pi_signed_out=1",
        label: "Keycloak",
        endsProviderSession: true,
      }),
    ).toEqual({
      loginUrl: "/idl/start",
      logoutUrl: "/idl/logout",
      tokenUrl: "/idl/token",
      postLogoutUrl: "/?pi_signed_out=1",
      label: "Keycloak",
      endsProviderSession: true,
    });
  });

  it("drops an off-origin tokenUrl / postLogoutUrl, a non-boolean endsProviderSession, and caps the label", () => {
    const out = sanitizeBrowserLoginConfig({
      loginUrl: "/idl/start",
      tokenUrl: "https://evil.example/token",
      postLogoutUrl: "//evil.example",
      endsProviderSession: "yes" as never,
      label: `  ${"K".repeat(100)}  `,
    });
    expect(out).toEqual({ loginUrl: "/idl/start", label: "K".repeat(40) });
  });

  it("ignores unknown fields (never forwards them to the browser)", () => {
    expect(sanitizeBrowserLoginConfig({ loginUrl: "/sso/login", evil: "x" } as never)).toEqual({ loginUrl: "/sso/login" });
  });
});

describe("publicLoginConfig (D21)", () => {
  it("discloses nothing when not enforced (null descriptor)", () => {
    expect(publicLoginConfig([])).toEqual({ active: false });
  });
  it("relays the D22 dashboard-UI fields to the browser", () => {
    expect(
      publicLoginConfig([
        {
          pluginId: "p",
          loginUrl: "/in",
          tokenUrl: "/tok",
          postLogoutUrl: "/?pi_signed_out=1",
          label: "Keycloak",
          endsProviderSession: false,
        },
      ]),
    ).toMatchObject({ active: true, pluginId: "p", loginUrl: "/in", tokenUrl: "/tok", postLogoutUrl: "/?pi_signed_out=1", label: "Keycloak", endsProviderSession: false });
  });
  it("relays only the vetted descriptor fields", () => {
    const one = { pluginId: "p", loginUrl: "/in", logoutUrl: "/out" };
    expect(publicLoginConfig([{ ...one, evil: "x" } as never])).toEqual({ active: true, ...one, providers: [one] });
  });

  it("silentSignIn (prompt=none support) is kept only as a strict boolean and relayed publicly", () => {
    expect(sanitizeBrowserLoginConfig({ loginUrl: "/in", silentSignIn: true })).toMatchObject({ silentSignIn: true });
    expect(sanitizeBrowserLoginConfig({ loginUrl: "/in", silentSignIn: "yes" as never })).not.toHaveProperty("silentSignIn");
    expect(publicLoginConfig([{ pluginId: "p", loginUrl: "/in", silentSignIn: true }])).toMatchObject({ active: true, silentSignIn: true });
  });

  it("lists every provider; the top-level fields mirror the first (back-compat) (D25)", () => {
    const kc = { pluginId: "identity-login-plane", loginUrl: "/idl/start", label: "Keycloak", silentSignIn: true };
    const gh = { pluginId: "github-login", loginUrl: "/gh/start", label: "GitHub", endsProviderSession: false };
    expect(publicLoginConfig([kc, gh])).toEqual({ active: true, ...kc, providers: [kc, gh] });
  });
});
