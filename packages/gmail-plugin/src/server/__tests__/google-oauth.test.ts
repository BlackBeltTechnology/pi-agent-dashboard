/**
 * L1 sign-in flow tests (test-plan E4, E5, E9, X7, X8) against a fake token
 * endpoint and a fake/real loopback callback. See change: add-gmail-plugin.
 */
import { request } from "node:http";
import { createLoopbackCallback, type PluginLoginInteraction } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT, fakeGoogleFetch, idToken, TEST_ENDPOINTS, validClaims } from "../../__tests__/fakes.js";
import { buildAuthUrl, createGoogleLoginFlow, GmailFlowError, parsePastedRedirect } from "../google-oauth.js";

const STATE = "S".repeat(43);

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Fake loopback callback whose code arrival the test controls. */
function fakeCallback() {
  const code = deferred<{ code: string }>();
  const close = vi.fn(() => code.reject(new Error("closed")));
  const factory = vi.fn(async () => ({
    redirectUri: "http://127.0.0.1:5555/",
    state: STATE,
    waitForCode: () => code.promise,
    close,
    server: {} as never,
  }));
  return { factory, code, close };
}

function fakeInteraction() {
  const paste = deferred<string>();
  const events: unknown[] = [];
  const ac = new AbortController();
  const ix: PluginLoginInteraction = {
    signal: ac.signal,
    prompt: vi.fn(async (p) => {
      p.signal?.addEventListener("abort", () => paste.reject(new Error("aborted")));
      return paste.promise;
    }),
    notify: (e) => events.push(e),
  };
  return { ix, paste, events, ac };
}

function tokenResponse(claims: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    access_token: "ACCESS-tok",
    refresh_token: "REFRESH-tok",
    expires_in: 3600,
    token_type: "Bearer",
    scope: "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.readonly",
    id_token: idToken(claims),
    ...extra,
  };
}

/** Nonce is generated inside the flow: read it back from the notified auth URL. */
function nonceFrom(events: unknown[]): string {
  const url = (events.find((e) => (e as { type: string }).type === "auth_url") as { url: string }).url;
  return new URL(url).searchParams.get("nonce") as string;
}

async function runLogin(claimsFor: (nonce: string) => Record<string, unknown>, extra?: Record<string, unknown>) {
  const cb = fakeCallback();
  const { ix, events } = fakeInteraction();
  const google = fakeGoogleFetch({ code: () => tokenResponse(claimsFor(nonceFrom(events)), extra) });
  const flow = createGoogleLoginFlow({
    client: CLIENT,
    endpoints: TEST_ENDPOINTS,
    tier: "readonly",
    fetchImpl: google.fetchImpl,
    createCallback: cb.factory as never,
  });
  const p = flow.login(ix);
  await vi.waitFor(() => expect(events.length).toBe(1));
  cb.code.resolve({ code: "the-code" });
  return { result: p, google };
}

describe("E4 — authorization URL", () => {
  it("carries the full tier scopes, offline + consent, login_hint, nonce, loopback redirect, no include_granted_scopes", () => {
    const url = new URL(
      buildAuthUrl({
        endpoints: TEST_ENDPOINTS,
        clientId: CLIENT.clientId,
        redirectUri: "http://127.0.0.1:4321/",
        tier: "draft",
        state: STATE,
        nonce: "N1",
        codeChallenge: "CC",
        loginHint: "a@x.com",
      }),
    );
    const q = url.searchParams;
    expect(q.get("scope")).toBe(
      "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
    );
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("prompt")).toBe("consent select_account");
    expect(q.get("login_hint")).toBe("a@x.com");
    expect(q.get("nonce")).toBe("N1");
    expect(q.get("redirect_uri")).toBe("http://127.0.0.1:4321/");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.has("include_granted_scopes")).toBe(false);
  });
});

describe("E5 — id_token claim validation", () => {
  it("accepts a valid id_token", async () => {
    const { result } = await runLogin((nonce) => validClaims({ nonce }));
    await expect(result).resolves.toMatchObject({ sub: "s1", email: "a@x.com", refresh: "REFRESH-tok", tier: "readonly" });
  });

  it.each([
    ["wrong aud", (n: string) => validClaims({ nonce: n, aud: "other.apps.googleusercontent.com" }), "id_token_invalid"],
    ["wrong iss", (n: string) => validClaims({ nonce: n, iss: "https://evil.example" }), "id_token_invalid"],
    [
      "expired",
      (n: string) => validClaims({ nonce: n, iat: Math.floor(Date.now() / 1000) - 7200, exp: Math.floor(Date.now() / 1000) - 3600 }),
      "id_token_invalid",
    ],
    ["nonce mismatch", () => validClaims({ nonce: "not-the-nonce" }), "id_token_invalid"],
    ["email_verified:false", (n: string) => validClaims({ nonce: n, email_verified: false }), "email_unverified"],
  ])("rejects %s", async (_label, claims, code) => {
    const { result } = await runLogin(claims);
    await expect(result).rejects.toMatchObject({ code });
  });

  it("flags a testing-mode grant (refresh_token_expires_in present)", async () => {
    const { result } = await runLogin((nonce) => validClaims({ nonce }), { refresh_token_expires_in: 604799 });
    await expect(result).resolves.toMatchObject({ testingHint: true });
  });
});

describe("E9 — pasted redirect", () => {
  it("parses the code when the state matches", () => {
    expect(parsePastedRedirect(`http://127.0.0.1:1/?code=c&state=${STATE}`, STATE)).toBe("c");
  });
  it("wrong state → state_mismatch, never echoing the input", () => {
    const input = "http://127.0.0.1:1/?code=SECRETCODE&state=WRONGSTATE";
    const err = (() => {
      try {
        parsePastedRedirect(input, STATE);
      } catch (e) {
        return e as GmailFlowError;
      }
    })();
    expect(err?.code).toBe("state_mismatch");
    expect(err?.message).not.toContain("SECRETCODE");
    expect(err?.message).not.toContain("WRONGSTATE");
  });
  it("garbage → invalid_redirect, never echoing the input", () => {
    const err = (() => {
      try {
        parsePastedRedirect("garbage-SECRET", STATE);
      } catch (e) {
        return e as GmailFlowError;
      }
    })();
    expect(err?.code).toBe("invalid_redirect");
    expect(err?.message).not.toContain("SECRET");
  });
});

describe("X8 — paste wins the race", () => {
  it("completes via the paste, closes the callback, no unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const cb = fakeCallback();
      const { ix, paste, events } = fakeInteraction();
      const google = fakeGoogleFetch({ code: () => tokenResponse(validClaims({ nonce: nonceFrom(events) })) });
      const p = createGoogleLoginFlow({
        client: CLIENT,
        endpoints: TEST_ENDPOINTS,
        tier: "readonly",
        fetchImpl: google.fetchImpl,
        createCallback: cb.factory as never,
      }).login(ix);
      await vi.waitFor(() => expect(events.length).toBe(1));
      paste.resolve(`http://127.0.0.1:5555/?code=pasted&state=${STATE}`);
      await expect(p).resolves.toMatchObject({ sub: "s1" });
      expect(cb.close).toHaveBeenCalled();
      expect(google.calls[0]?.body.get("code")).toBe("pasted");
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});

describe("X7 — cancel closes the loopback listener", () => {
  const acs: AbortController[] = [];
  afterEach(() => {
    for (const a of acs) a.abort();
  });

  it("aborting the interaction frees the port within 100 ms, no unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      let redirect = "";
      const spyFactory = (async (o: Parameters<typeof createLoopbackCallback>[0]) => {
        const cb = await createLoopbackCallback(o);
        redirect = cb.redirectUri;
        return cb;
      }) as typeof createLoopbackCallback;
      const { ix, ac } = fakeInteraction();
      acs.push(ac);
      const p = createGoogleLoginFlow({
        client: CLIENT,
        endpoints: TEST_ENDPOINTS,
        tier: "readonly",
        createCallback: spyFactory,
      }).login(ix);
      p.catch(() => {});
      await vi.waitFor(() => expect(redirect).not.toBe(""));
      ac.abort();
      await expect(p).rejects.toBeDefined();
      await new Promise((r) => setTimeout(r, 100));
      const port = Number(new URL(redirect).port);
      const refused = await new Promise<boolean>((resolve) => {
        const req = request({ host: "127.0.0.1", port, path: "/" }, () => resolve(false));
        req.on("error", () => resolve(true));
        req.end();
      });
      expect(refused).toBe(true);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
