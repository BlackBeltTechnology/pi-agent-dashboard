// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginLogin,
  beginLogout,
  CALLBACK_PATH,
  completeLogin,
  STASH_KEY,
} from "../login-flow.js";
import {
  clearAccessToken,
  getAccessToken,
  getIdToken,
  setAccessToken,
  setIdToken,
} from "../token-store.js";

/**
 * Provider-agnostic browser login/logout mechanics (D16/D17/D18, LG-8/10/13/14).
 * These exercise the pure engine any login-provider plugin drives; the plugin
 * component is a thin status wrapper over these functions.
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
    expect(result).toEqual({ kind: "error", reason: "idp-error" });
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
    expect(result).toEqual({ kind: "error", reason: "state-mismatch" });
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

describe("typed failure reasons (D17/R3)", () => {
  const stash = {
    verifier: "v",
    state: "s1",
    returnTo: "/x",
    tokenEndpoint: "https://kc.example/t",
    clientId: "dashboard-web",
    redirectUri: "https://dash.example/callback",
  };

  it("IdP ?error= carries reason idp-error", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const r = await completeLogin("?error=access_denied");
    expect(r).toEqual({ kind: "error", reason: "idp-error" });
  });

  it("state mismatch carries reason state-mismatch", async () => {
    sessionStorage.setItem(STASH_KEY, JSON.stringify(stash));
    vi.stubGlobal("fetch", vi.fn());
    const r = await completeLogin("?code=c&state=WRONG");
    expect(r).toEqual({ kind: "error", reason: "state-mismatch" });
  });

  it("a non-2xx token exchange resolves to exchange-failed (never rejects)", async () => {
    sessionStorage.setItem(STASH_KEY, JSON.stringify(stash));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) } as Response),
    );
    const r = await completeLogin("?code=c&state=s1");
    expect(r).toEqual({ kind: "error", reason: "exchange-failed" });
    expect(getAccessToken()).toBeNull();
  });

  it("a network failure during exchange resolves to exchange-failed", async () => {
    sessionStorage.setItem(STASH_KEY, JSON.stringify(stash));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const r = await completeLogin("?code=c&state=s1");
    expect(r).toEqual({ kind: "error", reason: "exchange-failed" });
  });

  it("beginLogin discovery failure rejects with reason discovery-failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => LOGIN_CONFIG } as Response)
        .mockRejectedValueOnce(new TypeError("Failed to fetch")),
    );
    await expect(beginLogin("/x")).rejects.toMatchObject({ reason: "discovery-failed" });
  });
});

// ── D18: plugin-owned RP-initiated logout ────────────────────────────────────
const DISCOVERY_LOGOUT = {
  ...DISCOVERY,
  end_session_endpoint: "https://kc.example/realms/dash/protocol/openid-connect/logout",
};

describe("beginLogout (D18)", () => {
  it("clears tokens then redirects to end_session with client_id + post_logout_redirect_uri + id_token_hint", async () => {
    setAccessToken("at", 300);
    setIdToken("idtok.abc");
    vi.stubGlobal("fetch", mockFetchJson(LOGIN_CONFIG, DISCOVERY_LOGOUT));
    await beginLogout();
    expect(getAccessToken()).toBeNull();
    expect(getIdToken()).toBeNull();
    expect(assignSpy).toHaveBeenCalledTimes(1);
    const url = new URL(assignSpy.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe(DISCOVERY_LOGOUT.end_session_endpoint);
    expect(url.searchParams.get("client_id")).toBe("dashboard-web");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://dash.example/");
    expect(url.searchParams.get("id_token_hint")).toBe("idtok.abc");
  });

  it("omits id_token_hint when no id token is held", async () => {
    setAccessToken("at", 300);
    vi.stubGlobal("fetch", mockFetchJson(LOGIN_CONFIG, DISCOVERY_LOGOUT));
    await beginLogout();
    const url = new URL(assignSpy.mock.calls[0][0] as string);
    expect(url.searchParams.get("id_token_hint")).toBeNull();
  });

  it("discovery failure: tokens are still cleared FIRST, then throws discovery-failed", async () => {
    setAccessToken("at", 300);
    setIdToken("idtok.abc");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net down")));
    await expect(beginLogout()).rejects.toMatchObject({ reason: "discovery-failed" });
    expect(getAccessToken()).toBeNull();
    expect(getIdToken()).toBeNull();
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("completeLogin retains the id_token for the later logout hint", async () => {
    sessionStorage.setItem(
      STASH_KEY,
      JSON.stringify({
        verifier: "v",
        state: "s1",
        returnTo: "/x",
        tokenEndpoint: "https://kc.example/tok",
        clientId: "dashboard-web",
        redirectUri: "https://dash.example/callback",
      }),
    );
    vi.stubGlobal("fetch", mockFetchJson({ access_token: "at2", expires_in: 60, id_token: "idtok.new" }));
    const r = await completeLogin("?code=c&state=s1");
    expect(r.kind).toBe("done");
    expect(getIdToken()).toBe("idtok.new");
  });
});
