import { WebStorageStateStore } from "oidc-client-ts";
import { afterEach, describe, expect, it } from "vitest";
import { buildOidcConfig } from "../react/oidc-config.js";

// E12 — ported from InvoiceBot `src/__tests__/auth-oidc-config.test.ts`
// (change: extract-standalone-app-kit, design D6).

const descriptor = { issuer: "https://kc/realms/r", clientId: "team-web" };
const redirectUri = "https://app/auth/callback";

afterEach(() => window.sessionStorage.clear());

describe("buildOidcConfig", () => {
  it("takes authority + client id from the descriptor and the redirect as given", () => {
    const cfg = buildOidcConfig(descriptor, { redirectUri });
    expect(cfg.authority).toBe(descriptor.issuer);
    expect(cfg.client_id).toBe("team-web");
    expect(cfg.redirect_uri).toBe(redirectUri);
  });

  it("is an Authorization Code + PKCE public client with silent renew", () => {
    const cfg = buildOidcConfig(descriptor, { redirectUri });
    expect(cfg.response_type).toBe("code");
    expect(cfg.client_secret).toBeUndefined();
    expect("client_secret" in cfg).toBe(false);
    expect(cfg.automaticSilentRenew).toBe(true);
    expect(typeof cfg.onSigninCallback).toBe("function");
  });

  it("keeps the user in sessionStorage, keyed per issuer + client", async () => {
    const cfg = buildOidcConfig(descriptor, { redirectUri });
    expect(cfg.userStore).toBeInstanceOf(WebStorageStateStore);
    await cfg.userStore?.set("user", "payload");
    expect(window.sessionStorage.getItem("oidc.user:https://kc/realms/r:team-web")).toBe("payload");
    expect(window.localStorage.length).toBe(0);
    expect(await cfg.userStore?.get("user")).toBe("payload");
    await cfg.userStore?.remove("user");
    expect(window.sessionStorage.length).toBe(0);
  });
});
