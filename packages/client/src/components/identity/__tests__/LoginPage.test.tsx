/**
 * The core LOGIN PAGE (`/login`, mockup login-logout.html v3). A full page:
 * nothing of the dashboard renders. One button per login provider (D25); a
 * live IdP session signs in with no click (silent prompt=none); explicit
 * sign-out and errors never auto-retry. Core ships no provider UI (D18).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/i18n/i18n.js", () => ({
  t: (_k: string, _v: unknown, fallback: string) => fallback,
  useI18n: () => ({ t: (_k: string, _v: unknown, fallback: string) => fallback, language: "en" }),
}));

const fetchLoginConfig = vi.fn();
vi.mock("../../../lib/identity/login-config.js", async (orig) => ({
  ...(await orig<typeof import("../../../lib/identity/login-config.js")>()),
  fetchLoginConfig: () => fetchLoginConfig(),
}));

const startSignIn = vi.fn(async (..._a: unknown[]) => {});
vi.mock("../../../lib/identity/dashboard-login.js", async (orig) => ({
  ...(await orig<typeof import("../../../lib/identity/dashboard-login.js")>()),
  startSignIn: (...a: unknown[]) => startSignIn(...a),
}));

function FakeProvider(props: { phase: string }) {
  return <div data-testid="fake-provider" data-phase={props.phase} />;
}
vi.mock("../../../generated/plugin-registry.js", () => ({
  PLUGIN_REGISTRY: [{ manifest: { id: "kc-component" }, claims: [{ slot: "login-provider", pluginId: "kc-component", Component: FakeProvider }] }],
}));

import { LAST_PROVIDER_KEY } from "../../../lib/identity/dashboard-login.js";
import { resetLoginSessionForTests, setLoginSessionForTests } from "../../../lib/identity/login-session.js";
import { LoginPage, SigningInPage } from "../LoginPage.js";

const kc = { pluginId: "idl", loginUrl: "/idl/start", tokenUrl: "/idl/token", label: "Keycloak", silentSignIn: true };
const gh = { pluginId: "gh", loginUrl: "/gh/start", tokenUrl: "/gh/token", label: "GitHub", endsProviderSession: false };
const cfg = (...providers: object[]) => ({ active: true, ...providers[0], providers });

beforeEach(() => {
  window.history.replaceState(null, "", "/login?returnTo=%2Fsession%2Fabc");
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  fetchLoginConfig.mockReset();
  startSignIn.mockClear();
  resetLoginSessionForTests();
});

const startedWith = (i = 0) => startSignIn.mock.calls[i] as [{ pluginId: string }, { returnTo: string; silent?: boolean }];

describe("LoginPage — one provider", () => {
  it("a full page: heading, ONE primary 'Sign in with <label>', 'Secured by <label>' — nothing else", async () => {
    setLoginSessionForTests({ silentMissed: true });
    fetchLoginConfig.mockResolvedValue(cfg(kc));
    render(<LoginPage />);
    const page = await screen.findByTestId("login-page");
    expect((page).getAttribute("data-variant")).toBe("signin");
    expect(screen.getByRole("heading", { name: "Sign in to pi-dashboard" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("Secured by Keycloak")).toBeTruthy();
    expect(screen.queryByText(/return to/i)).toBeNull();
  });

  it("the button goes to that provider's loginUrl carrying the page's returnTo", async () => {
    setLoginSessionForTests({ silentMissed: true });
    fetchLoginConfig.mockResolvedValue(cfg(kc));
    render(<LoginPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Keycloak" }));
    const [provider, deps] = startedWith();
    expect(provider.pluginId).toBe("idl");
    expect(deps.returnTo).toBe("/session/abc");
    expect(deps.silent).not.toBe(true);
  });

  it("an off-origin returnTo is never forwarded (falls back to /)", async () => {
    window.history.replaceState(null, "", "/login?returnTo=https%3A%2F%2Fevil.example%2F");
    setLoginSessionForTests({ silentMissed: true });
    fetchLoginConfig.mockResolvedValue(cfg(kc));
    render(<LoginPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Keycloak" }));
    expect(startedWith()[1].returnTo).toBe("/");
  });
});

describe("LoginPage — several providers (D25)", () => {
  it("lists EVERY provider as its own button, no single 'Secured by'", async () => {
    setLoginSessionForTests({ silentMissed: true });
    fetchLoginConfig.mockResolvedValue(cfg(kc, gh));
    render(<LoginPage />);
    expect(await screen.findByRole("button", { name: "Sign in with Keycloak" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" }));
    expect(startedWith()[0].pluginId).toBe("gh");
    expect(screen.queryByText(/Secured by/)).toBeNull();
  });

  it("skips a provider whose loginUrl is off-origin", async () => {
    setLoginSessionForTests({ silentMissed: true });
    fetchLoginConfig.mockResolvedValue(cfg(kc, { ...gh, loginUrl: "https://evil.example/x" }));
    render(<LoginPage />);
    await screen.findByRole("button", { name: "Sign in with Keycloak" });
    expect(screen.queryByRole("button", { name: "Sign in with GitHub" })).toBeNull();
  });
});

describe("LoginPage — silent sign-in (no click)", () => {
  it("returning user: starts prompt=none with the provider at once and shows only 'Signing you in'", async () => {
    fetchLoginConfig.mockResolvedValue(cfg(kc));
    render(<LoginPage />);
    await waitFor(() => expect(startSignIn).toHaveBeenCalled());
    const [provider, deps] = startedWith();
    expect(provider.pluginId).toBe("idl");
    expect(deps).toMatchObject({ silent: true, returnTo: "/session/abc" });
    expect(screen.getByTestId("signing-in")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("several providers: only the last-used one, and only if it supports silent", async () => {
    localStorage.setItem(LAST_PROVIDER_KEY, "idl");
    fetchLoginConfig.mockResolvedValue(cfg(gh, kc));
    render(<LoginPage />);
    await waitFor(() => expect(startSignIn).toHaveBeenCalled());
    expect(startedWith()[0].pluginId).toBe("idl");
  });

  it.each([
    ["the silent attempt found no IdP session", { silentMissed: true }],
    ["the user just signed out", { signedOut: true }],
    ["a sign-in error came back", { error: "idp_unreachable" }],
  ])("never auto-signs-in when %s", async (_why, session) => {
    setLoginSessionForTests(session);
    fetchLoginConfig.mockResolvedValue(cfg(kc));
    render(<LoginPage />);
    await screen.findByTestId("login-page");
    expect(startSignIn).not.toHaveBeenCalled();
  });

  it("a provider without silentSignIn waits for a click", async () => {
    fetchLoginConfig.mockResolvedValue(cfg(gh));
    render(<LoginPage />);
    await screen.findByRole("button", { name: "Sign in with GitHub" });
    expect(startSignIn).not.toHaveBeenCalled();
  });
});

describe("LoginPage — variants", () => {
  it("signed out: 'You're signed out' + the sign-in button", async () => {
    setLoginSessionForTests({ signedOut: true });
    fetchLoginConfig.mockResolvedValue(cfg(kc));
    render(<LoginPage />);
    expect(await screen.findByRole("heading", { name: "You're signed out" })).toBeTruthy();
    expect((screen.getByTestId("login-page")).getAttribute("data-variant")).toBe("signed-out");
    expect(screen.getByRole("button", { name: "Sign in with Keycloak" })).toBeTruthy();
  });

  it("expired (this page held a token, silent missed): 'Your session has expired'", async () => {
    setLoginSessionForTests({ hadToken: true, silentMissed: true });
    fetchLoginConfig.mockResolvedValue(cfg(kc));
    render(<LoginPage />);
    expect(await screen.findByRole("heading", { name: "Your session has expired" })).toBeTruthy();
  });

  it("error: plain words, Try again (not silent), host-owner break-glass hint", async () => {
    setLoginSessionForTests({ error: "idp_unreachable" });
    fetchLoginConfig.mockResolvedValue(cfg(kc));
    render(<LoginPage />);
    expect(await screen.findByRole("heading", { name: "Couldn't reach the sign-in service" })).toBeTruthy();
    expect(screen.getByText("Keycloak didn't respond.")).toBeTruthy();
    expect(screen.getByText("pi-dashboard login --local")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(startedWith()[1].silent).not.toBe(true);
  });

  it("inactive plane: 'No sign-in method installed', no button, no /auth/login link", async () => {
    fetchLoginConfig.mockResolvedValue({ active: false, providers: [] });
    render(<LoginPage />);
    expect(await screen.findByText("No sign-in method installed")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector('a[href*="/auth/login"]')).toBeNull();
  });

  it("component provider (D16 adapter, no loginUrl): the button mounts the plugin gate in start phase", async () => {
    setLoginSessionForTests({ silentMissed: true });
    fetchLoginConfig.mockResolvedValue(cfg({ pluginId: "kc-component", label: "Keycloak" }));
    render(<LoginPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Keycloak" }));
    expect((await screen.findByTestId("fake-provider")).getAttribute("data-phase")).toBe("start");
  });
});

describe("LoginPage — security", () => {
  it("a hostile #pi_login_error never reaches the DOM as markup (fixed copy only)", async () => {
    const payload = '<img src=x onerror="window.__pwned=1">';
    setLoginSessionForTests({ error: payload });
    fetchLoginConfig.mockResolvedValue(cfg(kc));
    render(<LoginPage />);
    await screen.findByRole("heading", { name: "Couldn't reach the sign-in service" });
    expect(document.querySelector("img")).toBeNull();
    expect(document.body.innerHTML).not.toContain("onerror");
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("a hostile provider label is rendered as text, never markup", async () => {
    setLoginSessionForTests({ silentMissed: true });
    fetchLoginConfig.mockResolvedValue(cfg({ ...kc, label: "<b>x</b><script>window.__pwned=1</script>" }));
    render(<LoginPage />);
    await screen.findByTestId("login-page");
    expect(document.querySelector("b, script")).toBeNull();
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("never renders the dashboard (no header, no sessions) while on the login page", async () => {
    setLoginSessionForTests({ silentMissed: true });
    fetchLoginConfig.mockResolvedValue(cfg(kc));
    render(<LoginPage />);
    await screen.findByTestId("login-page");
    expect(document.querySelector('[data-testid="header-app-bar"], [data-testid="user-bar"]')).toBeNull();
  });
});

describe("SigningInPage", () => {
  it("a status page with no button", () => {
    render(<SigningInPage />);
    expect(screen.getByRole("status").textContent).toContain("Signing you in");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
