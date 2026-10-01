import { afterEach, describe, expect, it, vi } from "vitest";
import { LAST_PROVIDER_KEY, PROVIDER_KEY, VERIFIER_KEY } from "../dashboard-login.js";
import { type BootDeps, bootLoginSession, getLoginSession, loginRedirectFor, resetLoginSessionForTests } from "../login-session.js";

function loc(href: string): Location {
  const u = new URL(href);
  return { pathname: u.pathname, search: u.search, hash: u.hash } as Location;
}
function hist() {
  return { state: null, replaceState: vi.fn() } as unknown as History & { replaceState: ReturnType<typeof vi.fn> };
}
function storage(verifier?: string, provider?: string): Storage {
  const m = new Map<string, string>([...(verifier ? [[VERIFIER_KEY, verifier]] : []), ...(provider ? [[PROVIDER_KEY, provider]] : [])] as [string, string][]);
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as Storage;
}
const kc = { pluginId: "idl", loginUrl: "/idl/start", tokenUrl: "/idl/token", label: "Keycloak" };
const gh = { pluginId: "gh", loginUrl: "/gh/start", tokenUrl: "/gh/token", label: "GitHub" };
const config = { active: true, ...kc, providers: [kc, gh] };

function deps(href: string, over: Partial<BootDeps> = {}): BootDeps & { history: ReturnType<typeof hist>; navigate: ReturnType<typeof vi.fn> } {
  let token = false;
  return {
    location: loc(href),
    history: hist(),
    storage: storage(),
    fetchFn: vi.fn(),
    fetchConfig: async () => config,
    setToken: vi.fn(() => {
      token = true;
    }),
    hasToken: () => token,
    persist: storage(),
    navigate: vi.fn(),
    ...over,
  } as never;
}

afterEach(() => resetLoginSessionForTests());

describe("bootLoginSession (D22 + login page)", () => {
  it("starts in `checking` so nothing renders before the decision", () => {
    expect(getLoginSession().phase).toBe("checking");
  });

  it("exchanges a #pi_handoff code, strips the fragment at once, stays on the page", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ access_token: "AT", expires_in: 300 })));
    const d = deps("http://h/session/1#pi_handoff=abc", { storage: storage("V"), fetchFn });
    const done = bootLoginSession(d);
    expect(d.history.replaceState).toHaveBeenCalledWith(null, "", "/session/1");
    await done;
    expect(d.setToken).toHaveBeenCalledWith("AT", 300);
    expect(d.navigate).not.toHaveBeenCalled();
    expect(getLoginSession()).toMatchObject({ phase: "idle", hadToken: true, error: undefined });
  });

  it("redeems at the tokenUrl of the provider that STARTED the sign-in and remembers it (D25)", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ access_token: "AT", expires_in: 300 })));
    const d = deps("http://h/#pi_handoff=abc", { storage: storage("V", "gh"), fetchFn });
    await bootLoginSession(d);
    expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toBe("/gh/token");
    expect(getLoginSession().providerId).toBe("gh");
    expect((d.persist as Storage).getItem(LAST_PROVIDER_KEY)).toBe("gh");
    expect(d.storage.getItem(PROVIDER_KEY)).toBeNull();
  });

  it("no remembered provider ⇒ the first provider's tokenUrl (single-provider / older flow)", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ access_token: "AT", expires_in: 300 })));
    await bootLoginSession(deps("http://h/#pi_handoff=abc", { storage: storage("V"), fetchFn }));
    expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toBe("/idl/token");
    expect(getLoginSession().providerId).toBe("idl");
  });

  it("enforced + no token ⇒ straight to /login with the target as returnTo (no dashboard render)", async () => {
    const d = deps("http://h/settings/providers?x=1");
    await bootLoginSession(d);
    expect(d.navigate).toHaveBeenCalledWith("/login?returnTo=%2Fsettings%2Fproviders%3Fx%3D1");
    expect(getLoginSession().phase).toBe("idle");
  });

  it("/ as the target ⇒ plain /login", async () => {
    const d = deps("http://h/");
    await bootLoginSession(d);
    expect(d.navigate).toHaveBeenCalledWith("/login");
  });

  it("not enforced (login-config inactive) ⇒ no redirect, dashboard as before", async () => {
    const d = deps("http://h/settings", { fetchConfig: async () => ({ active: false, providers: [] }) });
    await bootLoginSession(d);
    expect(d.navigate).not.toHaveBeenCalled();
    expect(getLoginSession().phase).toBe("idle");
  });

  it("never redirects away from /login, /pair, /callback, /logout", async () => {
    for (const p of ["/login", "/pair", "/callback", "/logout"]) {
      const d = deps(`http://h${p}`);
      await bootLoginSession(d);
      expect(d.navigate, p).not.toHaveBeenCalled();
    }
  });

  it("a failed exchange is an error and lands on /login", async () => {
    const d = deps("http://h/#pi_handoff=abc");
    await bootLoginSession(d);
    expect(getLoginSession()).toMatchObject({ phase: "idle", hadToken: false, error: "missing_verifier" });
    expect(d.navigate).toHaveBeenCalledWith("/login");
  });

  it("a provider error in the fragment is remembered for the login page", async () => {
    const d = deps("http://h/#pi_login_error=idp_unreachable");
    await bootLoginSession(d);
    expect(d.history.replaceState).toHaveBeenCalledWith(null, "", "/");
    expect(getLoginSession().error).toBe("idp_unreachable");
  });

  it("login_required (silent attempt, no IdP session) is NOT an error — the page just waits for a click", async () => {
    const d = deps("http://h/session/9#pi_login_error=login_required");
    await bootLoginSession(d);
    expect(getLoginSession().silentMissed).toBe(true);
    expect(getLoginSession().error).toBeUndefined();
    expect(d.navigate).toHaveBeenCalledWith("/login?returnTo=%2Fsession%2F9");
  });

  it("recognises the signed-out landing and strips the marker", async () => {
    const d = deps("http://h/login?pi_signed_out=1&x=2");
    await bootLoginSession(d);
    expect(d.history.replaceState).toHaveBeenCalledWith(null, "", "/login?x=2");
    expect(getLoginSession().signedOut).toBe(true);
  });

  it("an unreachable login-config fails OPEN to the dashboard (the server floor still refuses data)", async () => {
    const d = deps("http://h/", { fetchConfig: async () => Promise.reject(new Error("down")) });
    await bootLoginSession(d);
    expect(d.navigate).not.toHaveBeenCalled();
    expect(getLoginSession().phase).toBe("idle");
  });
});

describe("loginRedirectFor (session lost mid-page ⇒ the login page)", () => {
  it("auth_required on a dashboard route ⇒ /login?returnTo=<route>", () => {
    expect(loginRedirectFor("auth_required", "/session/abc", "?t=1")).toBe("/login?returnTo=%2Fsession%2Fabc%3Ft%3D1");
    expect(loginRedirectFor("auth_required", "/", "")).toBe("/login");
  });
  it("never while connected/connecting, and never from /login itself", () => {
    expect(loginRedirectFor("connected", "/settings", "")).toBeNull();
    expect(loginRedirectFor("connecting", "/settings", "")).toBeNull();
    expect(loginRedirectFor("auth_required", "/login", "")).toBeNull();
  });
});
