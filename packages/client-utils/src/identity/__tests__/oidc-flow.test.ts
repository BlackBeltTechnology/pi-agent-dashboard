import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuthorizeRequest, exchangeCode, type OidcClientConfig } from "../oidc-flow.js";

const config: OidcClientConfig = {
  authorizationEndpoint: "https://kc.example/realms/app/protocol/openid-connect/auth",
  tokenEndpoint: "https://kc.example/realms/app/protocol/openid-connect/token",
  clientId: "dashboard-web",
  redirectUri: "https://dash.example/callback",
};

describe("buildAuthorizeRequest (§12.1)", () => {
  it("builds an S256 auth-code URL and returns the verifier/state to retain", async () => {
    const req = await buildAuthorizeRequest(config);
    const u = new URL(req.url);
    expect(u.origin + u.pathname).toBe(config.authorizationEndpoint);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("dashboard-web");
    expect(u.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(u.searchParams.get("scope")).toBe("openid");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBeTruthy();
    expect(u.searchParams.get("state")).toBe(req.state);
    expect(req.verifier.length).toBeGreaterThanOrEqual(43);
  });
});

describe("exchangeCode (§12.1)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts form-encoded PKCE params and normalizes the token response", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ access_token: "at-1", expires_in: 300, token_type: "DPoP" })),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const out = await exchangeCode(config, { code: "auth-code", verifier: "verifier-xyz" }, { DPoP: "proof" });
    expect(out).toEqual({ accessToken: "at-1", expiresIn: 300, tokenType: "DPoP" });

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(config.tokenEndpoint);
    const body = new URLSearchParams(String((init as RequestInit).body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("code_verifier")).toBe("verifier-xyz");
    expect(new Headers((init as RequestInit).headers).get("DPoP")).toBe("proof");
  });

  it("throws on a non-2xx token response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 400 })));
    await expect(exchangeCode(config, { code: "c", verifier: "v" })).rejects.toThrow(/token exchange failed: 400/);
  });

  it("throws when the response carries no access_token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ expires_in: 300 }))));
    await expect(exchangeCode(config, { code: "c", verifier: "v" })).rejects.toThrow(/no access_token/);
  });
});
