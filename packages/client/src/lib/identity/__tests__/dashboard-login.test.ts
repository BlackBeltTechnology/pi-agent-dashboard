import { describe, expect, it, vi } from "vitest";
import {
  buildSignInUrl,
  completeHandoff,
  LAST_PROVIDER_KEY,
  loginPathFor,
  PROVIDER_KEY,
  readLoginReturn,
  signOutTarget,
  silentProviderFor,
  startSignIn,
  stripLoginReturn,
  VERIFIER_KEY,
} from "../dashboard-login.js";

const ORIGIN = "http://127.0.0.1:8000";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

describe("buildSignInUrl (D22)", () => {
  it("appends a validated returnTo and the PKCE challenge to the same-origin loginUrl", () => {
    const url = buildSignInUrl("/idl/start", "/session/abc?x=1", "CH", ORIGIN);
    const u = new URL(url ?? "", ORIGIN);
    expect(u.pathname).toBe("/idl/start");
    expect(u.searchParams.get("returnTo")).toBe("/session/abc?x=1");
    expect(u.searchParams.get("challenge")).toBe("CH");
  });

  it("refuses an off-origin loginUrl and collapses an off-origin returnTo to /", () => {
    expect(buildSignInUrl("https://evil.example/x", "/", "CH", ORIGIN)).toBeNull();
    const u = new URL(buildSignInUrl("/idl/start", "https://evil.example/", "CH", ORIGIN) ?? "", ORIGIN);
    expect(u.searchParams.get("returnTo")).toBe("/");
  });
});

describe("startSignIn (D22)", () => {
  it("stores the verifier (never a credential) and navigates straight to the login URL", async () => {
    const storage = memoryStorage();
    const assign = vi.fn();
    await startSignIn(
      { pluginId: "idl", loginUrl: "/idl/start" },
      { origin: ORIGIN, returnTo: "/", storage, assign, pkce: async () => ({ verifier: "V", challenge: "C", method: "S256" }) },
    );
    expect(storage.getItem(VERIFIER_KEY)).toBe("V");
    expect(storage.getItem(PROVIDER_KEY)).toBe("idl"); // which provider's tokenUrl redeems the handoff (D25)
    expect(assign).toHaveBeenCalledWith("/idl/start?returnTo=%2F&challenge=C");
  });

  it("silent: adds prompt=none so a live IdP session signs in with no click", async () => {
    const assign = vi.fn();
    await startSignIn(
      { pluginId: "idl", loginUrl: "/idl/start" },
      { origin: ORIGIN, returnTo: "/", storage: memoryStorage(), assign, silent: true, pkce: async () => ({ verifier: "V", challenge: "C", method: "S256" }) },
    );
    expect(assign).toHaveBeenCalledWith("/idl/start?returnTo=%2F&challenge=C&prompt=none");
  });

  it("does nothing without a usable loginUrl", async () => {
    const assign = vi.fn();
    await startSignIn({ pluginId: "idl" }, { origin: ORIGIN, returnTo: "/", storage: memoryStorage(), assign });
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("readLoginReturn / stripLoginReturn (D22)", () => {
  it("reads a one-time handoff code", () => {
    expect(readLoginReturn("#pi_handoff=abc")).toEqual({ kind: "handoff", code: "abc" });
  });
  it("reads a provider error", () => {
    expect(readLoginReturn("#pi_login_error=idp_unreachable")).toEqual({ kind: "error", reason: "idp_unreachable" });
  });
  it("is null for an ordinary page load", () => {
    expect(readLoginReturn("")).toBeNull();
    expect(readLoginReturn("#section-2")).toBeNull();
  });
  it("strips only the keys it owns", () => {
    expect(stripLoginReturn("#pi_handoff=abc")).toBe("");
    expect(stripLoginReturn("#pi_handoff=abc&keep=1")).toBe("#keep=1");
  });
});

describe("completeHandoff (D22)", () => {
  it("exchanges {code, verifier} at tokenUrl, stores the bearer in memory, and forgets the verifier", async () => {
    const storage = memoryStorage();
    storage.setItem(VERIFIER_KEY, "V");
    const setToken = vi.fn();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ access_token: "AT", expires_in: 300 }), { status: 200 }));
    const res = await completeHandoff({ code: "abc", tokenUrl: "/idl/token", storage, fetchFn, setToken });
    expect(res).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledWith("/idl/token", expect.objectContaining({ method: "POST", body: JSON.stringify({ code: "abc", verifier: "V" }) }));
    expect(setToken).toHaveBeenCalledWith("AT", 300);
    expect(storage.getItem(VERIFIER_KEY)).toBeNull();
  });

  it("keeps the IdP id_token in memory too (for a confirm-free sign-out)", async () => {
    const storage = memoryStorage();
    storage.setItem(VERIFIER_KEY, "V");
    const setIdToken = vi.fn();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ access_token: "AT", id_token: "h.p.s", expires_in: 300 }), { status: 200 }));
    await completeHandoff({ code: "abc", tokenUrl: "/idl/token", storage, fetchFn, setToken: vi.fn(), setIdToken });
    expect(setIdToken).toHaveBeenCalledWith("h.p.s");
  });

  it("fails without a stored verifier (a code alone is useless)", async () => {
    const fetchFn = vi.fn();
    const res = await completeHandoff({ code: "abc", tokenUrl: "/idl/token", storage: memoryStorage(), fetchFn, setToken: vi.fn() });
    expect(res).toEqual({ ok: false, reason: "missing_verifier" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("fails closed on a rejected exchange and still forgets the verifier", async () => {
    const storage = memoryStorage();
    storage.setItem(VERIFIER_KEY, "V");
    const setToken = vi.fn();
    const fetchFn = vi.fn(async () => new Response("{}", { status: 400 }));
    const res = await completeHandoff({ code: "abc", tokenUrl: "/idl/token", storage, fetchFn, setToken });
    expect(res).toEqual({ ok: false, reason: "exchange_failed" });
    expect(setToken).not.toHaveBeenCalled();
    expect(storage.getItem(VERIFIER_KEY)).toBeNull();
  });
});

describe("signOutTarget (D22)", () => {
  it("goes to the plugin's logoutUrl with a returnTo", () => {
    expect(signOutTarget({ logoutUrl: "/idl/logout" }, ORIGIN)).toBe("/idl/logout?returnTo=%2Flogin");
  });
  it("carries the id_token as id_token_hint so the IdP signs out without its confirm page", () => {
    expect(signOutTarget({ logoutUrl: "/idl/logout" }, ORIGIN, "h.p.s")).toBe("/idl/logout?returnTo=%2Flogin&id_token_hint=h.p.s");
    expect(signOutTarget({ logoutUrl: "/idl/logout" }, ORIGIN, null)).toBe("/idl/logout?returnTo=%2Flogin");
  });
  it("falls back to the signed-out login page when the provider has no logoutUrl", () => {
    expect(signOutTarget(undefined, ORIGIN)).toBe("/login?pi_signed_out=1");
  });
});

describe("loginPathFor (the core login page)", () => {
  it("carries a dashboard target as returnTo; / and /login collapse to plain /login", () => {
    expect(loginPathFor("/session/a?b=1")).toBe("/login?returnTo=%2Fsession%2Fa%3Fb%3D1");
    expect(loginPathFor("/")).toBe("/login");
    expect(loginPathFor("/login?returnTo=%2Fx")).toBe("/login");
  });
});

describe("silentProviderFor (no-click sign-in, D25)", () => {
  const kc = { pluginId: "kc", loginUrl: "/kc/start", silentSignIn: true };
  const gh = { pluginId: "gh", loginUrl: "/gh/start" };
  const cfg = (...providers: (typeof kc | typeof gh)[]) => ({ active: true, providers });
  it("one provider that supports it ⇒ that one", () => {
    expect(silentProviderFor(cfg(kc), null)).toEqual(kc);
  });
  it("one provider without silentSignIn ⇒ none (the page waits for a click)", () => {
    expect(silentProviderFor(cfg(gh), null)).toBeUndefined();
  });
  it("several ⇒ only the LAST-USED one, and only if it supports it", () => {
    expect(silentProviderFor(cfg(kc, gh), null)).toBeUndefined();
    expect(silentProviderFor(cfg(kc, gh), "kc")).toEqual(kc);
    expect(silentProviderFor(cfg(kc, gh), "gh")).toBeUndefined();
    expect(silentProviderFor(cfg(kc, gh), "removed-plugin")).toBeUndefined();
  });
  it("uses a stable, non-credential localStorage key", () => {
    expect(LAST_PROVIDER_KEY).toBe("pi-dashboard:last-login-provider");
  });
});
