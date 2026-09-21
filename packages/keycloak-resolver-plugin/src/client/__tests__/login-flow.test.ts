// @vitest-environment jsdom
import { clearAccessToken, getAccessToken } from "@blackbelt-technology/pi-dashboard-client-utils/identity/token-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginLogin, CALLBACK_PATH, completeLogin, STASH_KEY } from "../login-flow.js";

/**
 * D16 browser login mechanics (LG-8/10/13/14). These exercise the pure flow
 * that the KeycloakLogin component drives; the component itself is a thin
 * status wrapper over these functions.
 */

const LOGIN_CONFIG = {
  active: true,
  issuer: "https://kc.example/realms/dash",
  clientId: "dashboard-web",
};
const DISCOVERY = {
  authorization_endpoint: "https://kc.example/realms/dash/protocol/openid-connect/auth",
  token_endpoint: "https://kc.example/realms/dash/protocol/openid-connect/token",
};

function mockFetchJson(...bodies: unknown[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const body of bodies) {
    fn.mockResolvedValueOnce({ ok: true, json: async () => body } as Response);
  }
  return fn;
}

let assignSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  clearAccessToken();
  assignSpy = vi.fn();
  // jsdom's location.assign throws "Not implemented" — replace it with a spy.
  Object.defineProperty(window, "location", {
    value: { origin: "https://dash.example", assign: assignSpy, search: "" },
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("beginLogin (start phase, LG-8)", () => {
  it("builds a PKCE-S256 authorize URL, persists {verifier,state,returnTo}, redirects", async () => {
    vi.stubGlobal("fetch", mockFetchJson(LOGIN_CONFIG, DISCOVERY));

    await beginLogin("/session/abc");

    expect(assignSpy).toHaveBeenCalledTimes(1);
    const url = new URL(assignSpy.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe(DISCOVERY.authorization_endpoint);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("client_id")).toBe("dashboard-web");
    expect(url.searchParams.get("redirect_uri")).toBe(`https://dash.example${CALLBACK_PATH}`);

    const stash = JSON.parse(sessionStorage.getItem(STASH_KEY) ?? "{}");
    expect(stash.returnTo).toBe("/session/abc");
    expect(stash.state).toBe(url.searchParams.get("state"));
    expect(stash.verifier).toBeTruthy();
    expect(stash.tokenEndpoint).toBe(DISCOVERY.token_endpoint);
  });

  it("throws (no redirect) when login is not configured", async () => {
    vi.stubGlobal("fetch", mockFetchJson({ active: false }));
    await expect(beginLogin("/")).rejects.toThrow();
    expect(assignSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(STASH_KEY)).toBeNull();
  });
});

describe("completeLogin (callback phase)", () => {
  it("IdP error response skips the exchange (LG-14)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await completeLogin("?error=access_denied");
    expect(result).toEqual({ kind: "error" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getAccessToken()).toBeNull();
  });

  it("missing stash lands idle, no exchange, no token (LG-13)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await completeLogin("?code=abc&state=xyz");
    expect(result).toEqual({ kind: "idle" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getAccessToken()).toBeNull();
  });

  it("state mismatch aborts before any exchange (LG-10)", async () => {
    sessionStorage.setItem(
      STASH_KEY,
      JSON.stringify({
        verifier: "v",
        state: "EXPECTED",
        returnTo: "/",
        tokenEndpoint: DISCOVERY.token_endpoint,
        clientId: "dashboard-web",
        redirectUri: "https://dash.example/callback",
      }),
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await completeLogin("?code=abc&state=ATTACKER");
    expect(result).toEqual({ kind: "error" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getAccessToken()).toBeNull();
    // The stash is left intact for a legitimate retry; nothing was consumed.
    expect(sessionStorage.getItem(STASH_KEY)).toBeTruthy();
  });

  it("happy path exchanges code, stores the bearer, clears the stash, returns return-to (LG-9 core)", async () => {
    sessionStorage.setItem(
      STASH_KEY,
      JSON.stringify({
        verifier: "verifier-123",
        state: "MATCHING",
        returnTo: "/session/abc",
        tokenEndpoint: DISCOVERY.token_endpoint,
        clientId: "dashboard-web",
        redirectUri: "https://dash.example/callback",
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: "AT", expires_in: 300, token_type: "Bearer" }),
      } as Response),
    );

    const result = await completeLogin("?code=the-code&state=MATCHING");

    expect(result).toEqual({ kind: "done", returnTo: "/session/abc" });
    expect(getAccessToken()).toBe("AT");
    expect(sessionStorage.getItem(STASH_KEY)).toBeNull();
  });
});
