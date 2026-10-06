/**
 * Sign-in gate + same-origin login seam (X8, F17, F22 client side).
 * See change: add-team-plugin.
 */
import { getAccessToken, resetAppConfig, resetIdentityState } from "@blackbelt-technology/pi-dashboard-app-kit";
import { AppHostProvider, type Identity, IdentityProvider } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Gate } from "../shell/Gate.js";
import { bootSeam, type SeamDeps, SeamIdentityProvider } from "../shell/seam-identity.js";
import { bootRoutes, json, makeHost } from "./helpers.js";

beforeEach(() => {
  resetAppConfig();
  resetIdentityState();
  sessionStorage.clear();
});

const jwt = (claims: Record<string, unknown>) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, "")}.s`;
const PROVIDER = { active: true, providers: [{ pluginId: "kc", loginUrl: "/api/plugins/keycloak/login", tokenUrl: "/api/plugins/keycloak/token", logoutUrl: "/api/plugins/keycloak/logout", label: "Keycloak" }] };

function deps(over: Partial<SeamDeps> & { config?: unknown; token?: Response }): SeamDeps & { assigned: string[]; calls: string[] } {
  const calls: string[] = [];
  const assigned: string[] = [];
  const d: SeamDeps & { assigned: string[]; calls: string[] } = {
    fetchFn: (async (url: string) => {
      calls.push(String(url));
      if (String(url).includes("/login-config")) return over.config === "fail" ? Promise.reject(new Error("net")) : json(over.config ?? PROVIDER);
      if (String(url).includes("/token")) return over.token ?? json({ access_token: jwt({ iss: "https://kc", sub: "alice", preferred_username: "alice" }), expires_in: 300 });
      return json({}, 404);
    }) as unknown as typeof fetch,
    storage: sessionStorage,
    origin: "http://localhost",
    hash: "",
    pathWithSearch: "/apps/team/agent/shared:backend",
    assign: (u) => assigned.push(u),
    replaceHash: vi.fn(),
    assigned,
    calls,
    ...over,
  };
  return d;
}

describe("bootSeam", () => {
  it("descriptor unreachable / non-2xx / malformed ⇒ unavailable (fail closed)", async () => {
    expect((await bootSeam(deps({ config: "fail" }))).kind).toBe("unavailable");
    expect((await bootSeam(deps({ config: { active: "maybe" } }))).kind).toBe("unavailable");
    expect((await bootSeam(deps({ config: { active: true, providers: [{ pluginId: "x" }] } }))).kind).toBe("unavailable");
  });

  it("identity inactive ⇒ none (single-user)", async () => {
    expect((await bootSeam(deps({ config: { active: false } }))).kind).toBe("none");
  });

  it("active, no credential ⇒ signedOut (no silent provider), and no team data request was made", async () => {
    const d = deps({});
    const p = await bootSeam(d);
    expect(p.kind).toBe("signedOut");
    expect(d.calls.every((c) => !c.includes("/api/plugins/team"))).toBe(true);
  });

  it("handoff in the fragment is exchanged, bearer stored in memory, fragment stripped (F22)", async () => {
    sessionStorage.setItem("pi-dashboard:login-verifier", "verifier");
    const d = deps({ hash: "#pi_handoff=CODE" });
    const p = await bootSeam(d);
    expect(p.kind).toBe("signedIn");
    expect(getAccessToken()).toMatch(/^h\./);
    expect(d.replaceHash).toHaveBeenCalledWith("");
    expect(d.calls.some((c) => c.endsWith("/api/plugins/keycloak/token"))).toBe(true);
  });

  it("handoff without a verifier or an exchange failure ⇒ signedOut with the reason", async () => {
    const p1 = await bootSeam(deps({ hash: "#pi_handoff=CODE" }));
    expect(p1).toMatchObject({ kind: "signedOut", error: "missing_verifier" });
    sessionStorage.setItem("pi-dashboard:login-verifier", "v");
    const p2 = await bootSeam(deps({ hash: "#pi_handoff=CODE", token: json({}, 400) }));
    expect(p2).toMatchObject({ kind: "signedOut", error: "exchange_failed" });
    expect(getAccessToken()).toBeNull();
  });

  it("silent sign-in is tried once per tab session, returning to the requested /apps/team/ path (F22)", async () => {
    const cfg = { active: true, providers: [{ ...PROVIDER.providers[0], silentSignIn: true }] };
    const d = deps({ config: cfg });
    const p = await bootSeam(d);
    expect(p.kind).toBe("redirecting");
    expect(d.assigned[0]).toContain("/api/plugins/keycloak/login");
    expect(decodeURIComponent(d.assigned[0])).toContain("returnTo=/apps/team/agent/shared:backend");
    expect(d.assigned[0]).toContain("prompt=none");
    expect((await bootSeam(deps({ config: cfg }))).kind).toBe("signedOut"); // second load: no loop
  });
});

describe("Gate", () => {
  const identity = (over: Partial<Identity>): Identity => ({
    mode: "oidc",
    available: true,
    loading: false,
    authenticated: false,
    operator: null,
    signInReady: true,
    signIn: vi.fn(),
    signOut: vi.fn(),
    ...over,
  });

  it("signed out ⇒ sign-in view, children (and so team requests) are not rendered", async () => {
    const host = makeHost();
    bootRoutes(host);
    const child = vi.fn(() => <p>APP</p>);
    const Child = () => child();
    render(
      <AppHostProvider host={host}>
        <IdentityProvider value={identity({})}>
          <Gate>
            <Child />
          </Gate>
        </IdentityProvider>
      </AppHostProvider>,
    );
    expect(await screen.findByTestId("signin")).toBeTruthy();
    expect(child).not.toHaveBeenCalled();
    expect(host.calls.filter((c) => c.path.includes("/api/plugins/team")).length).toBe(0);
  });

  it("X8: identity unavailable ⇒ 'sign-in unavailable', no team data", async () => {
    const host = makeHost();
    bootRoutes(host);
    render(
      <AppHostProvider host={host}>
        <IdentityProvider value={identity({ mode: "unavailable", available: false })}>
          <Gate><p>APP</p></Gate>
        </IdentityProvider>
      </AppHostProvider>,
    );
    await screen.findByText("A bejelentkezés most nem érhető el.");
    expect(screen.queryByText("APP")).toBeNull();
  });

  it("X8: host refuses a credential-less caller (403, none mode) ⇒ 'not admitted' explaining network admission", async () => {
    const host = makeHost();
    host.routes.set("GET /api/plugins/team/me", () => json({ error: "forbidden" }, 403));
    host.routes.set("GET /api/plugins/team/projects", () => json({ error: "forbidden" }, 403));
    render(
      <AppHostProvider host={host}>
        <IdentityProvider value={identity({ mode: "none", available: false, authenticated: true, operator: { iss: "local", sub: "local" } })}>
          <Gate><p>APP</p></Gate>
        </IdentityProvider>
      </AppHostProvider>,
    );
    await screen.findByText("Ez a dashboard nem fogadja ezt a címet.");
    expect(screen.getByText(/trustedNetworks/)).toBeTruthy();
    expect(screen.queryByText("APP")).toBeNull();
  });

  it("signed in ⇒ children render and data is requested", async () => {
    const host = makeHost();
    bootRoutes(host);
    render(
      <AppHostProvider host={host}>
        <IdentityProvider value={identity({ authenticated: true, operator: { iss: "i", sub: "s" } })}>
          <Gate><p>APP</p></Gate>
        </IdentityProvider>
      </AppHostProvider>,
    );
    await screen.findByText("APP");
  });
});

describe("credential arriving while the first call is in flight", () => {
  it("the refused first call is retried once the identity publishes its credential", async () => {
    const host = makeHost();
    let credential = false;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const listeners = new Set<() => void>();
    host.identity = { current: () => null, subscribe: (cb) => (listeners.add(cb), () => listeners.delete(cb)) };
    host.routes.set("GET /api/plugins/team/me", async () => {
      const had = credential;
      if (!had) await gate;
      return had ? { uk: "u", iss: "i", sub: "s", admin: false, mode: "multi", maxConversations: 50, skills: [] } : json({ error: "x" }, 401);
    });
    host.routes.set("GET /api/plugins/team/projects", () => ({ projects: [] }));
    render(
      <AppHostProvider host={host}>
        <Gate>
          <p>APP</p>
        </Gate>
      </AppHostProvider>,
    );
    await waitFor(() => expect(host.calls.length).toBeGreaterThanOrEqual(1));
    credential = true; // the bridge publishes its token while the first call is still pending
    for (const l of listeners) l();
    release(); // the first call now resolves 401
    await screen.findByText("APP");
  });
});

describe("SeamIdentityProvider", () => {
  it("none mode ⇒ authenticated local operator", async () => {
    const host = makeHost();
    bootRoutes(host);
    const d = deps({ config: { active: false } });
    render(
      <AppHostProvider host={host}>
        <SeamIdentityProvider deps={d}>
          <Gate><p>APP</p></Gate>
        </SeamIdentityProvider>
      </AppHostProvider>,
    );
    await screen.findByText("APP");
  });

  it("signed out ⇒ sign-in view; clicking starts the redirect to the login URL with the app path", async () => {
    const host = makeHost();
    bootRoutes(host);
    const d = deps({});
    render(
      <AppHostProvider host={host}>
        <SeamIdentityProvider deps={d}>
          <Gate><p>APP</p></Gate>
        </SeamIdentityProvider>
      </AppHostProvider>,
    );
    const btn = await screen.findByTestId("signin");
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    btn.click();
    await waitFor(() => expect(d.assigned.length).toBe(1));
    expect(decodeURIComponent(d.assigned[0])).toContain("returnTo=/apps/team/agent/shared:backend");
    expect(host.calls.filter((c) => c.path.includes("/api/plugins/team")).length).toBe(0);
  });
});
