import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureDashboard, resetAppConfig } from "../config.js";
import { getAccessToken, notifySessionRefused, resetIdentityState, setIdentityMode } from "../identity-state.js";
import { type Identity, LOCAL_OPERATOR, OidcIdentityBridge, useIdentity } from "../react/identity-context.js";
import { authedFetch, NoCredentialError } from "../transport.js";

// F1–F4 — the OIDC identity bridge (change: extract-standalone-app-kit, design
// D8). Ported from InvoiceBot's `identity-context.tsx` without its product
// role read; `react-oidc-context` is replaced by a controllable fake.

interface FakeAuth {
  user: { access_token: string; profile: Record<string, unknown> } | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  activeNavigator?: string;
  settings: Record<string, unknown>;
  signinRedirect: ReturnType<typeof vi.fn>;
  signoutRedirect: ReturnType<typeof vi.fn>;
  removeUser: ReturnType<typeof vi.fn>;
}
const authHolder: { auth: FakeAuth } = { auth: makeAuth("a") };
vi.mock("react-oidc-context", () => ({ useAuth: () => authHolder.auth }));

function makeAuth(token: string | null): FakeAuth {
  return {
    user: token ? { access_token: token, profile: { iss: "https://kc/realms/r", sub: "u1", preferred_username: "anna" } } : null,
    isLoading: false,
    isAuthenticated: token !== null,
    settings: {},
    signinRedirect: vi.fn(async () => {}),
    signoutRedirect: vi.fn(async () => {}),
    removeUser: vi.fn(async () => {}),
  };
}

let seen: Identity | null = null;
function Probe() {
  seen = useIdentity();
  return <span data-testid="role">{String(seen.role)}</span>;
}

const DASH = "https://dash.example.com";
type FetchSpy = ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;
let fetchSpy: FetchSpy;

beforeEach(() => {
  resetIdentityState();
  resetAppConfig();
  configureDashboard({ dashboardUrl: DASH });
  fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
  seen = null;
});
afterEach(() => {
  cleanup();
  resetIdentityState();
  resetAppConfig();
  vi.unstubAllGlobals();
});

describe("OidcIdentityBridge (oidc mode)", () => {
  beforeEach(() => setIdentityMode("oidc"));

  it("F1: the transport token follows the OIDC user across a renewal", async () => {
    authHolder.auth = makeAuth("a");
    const view = render(
      <OidcIdentityBridge>
        <Probe />
      </OidcIdentityBridge>,
    );
    await authedFetch("/api/x");
    expect(new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer a");

    authHolder.auth = makeAuth("b");
    view.rerender(
      <OidcIdentityBridge>
        <Probe />
      </OidcIdentityBridge>,
    );
    await authedFetch("/api/x");
    expect(new Headers(fetchSpy.mock.calls[1]?.[1]?.headers).get("Authorization")).toBe("Bearer b");
    expect(seen?.operator).toEqual({ iss: "https://kc/realms/r", sub: "u1" });
    expect(seen?.username).toBe("anna");
    expect(seen?.mode).toBe("oidc");
  });

  it("F2: signOut() clears the transport token; authedFetch then throws", async () => {
    authHolder.auth = makeAuth("a");
    render(
      <OidcIdentityBridge>
        <Probe />
      </OidcIdentityBridge>,
    );
    expect(getAccessToken()).toBe("a");
    act(() => seen?.signOut());
    expect(getAccessToken()).toBeNull();
    expect(authHolder.auth.signoutRedirect).toHaveBeenCalledTimes(1);
    await expect(authedFetch("/api/x")).rejects.toBeInstanceOf(NoCredentialError);
  });

  it("F2: a server refusal clears the token without re-starting sign-in", async () => {
    authHolder.auth = makeAuth("a");
    render(
      <OidcIdentityBridge>
        <Probe />
      </OidcIdentityBridge>,
    );
    act(() => notifySessionRefused());
    expect(getAccessToken()).toBeNull();
    expect(authHolder.auth.removeUser).toHaveBeenCalledTimes(1);
    expect(authHolder.auth.signinRedirect).not.toHaveBeenCalled();
    await expect(authedFetch("/api/x")).rejects.toBeInstanceOf(NoCredentialError);
  });

  it("signIn() starts the redirect", () => {
    authHolder.auth = makeAuth(null);
    render(
      <OidcIdentityBridge>
        <Probe />
      </OidcIdentityBridge>,
    );
    act(() => seen?.signIn());
    expect(authHolder.auth.signinRedirect).toHaveBeenCalledTimes(1);
  });

  it("F4: role comes only from the caller's resolver", async () => {
    authHolder.auth = makeAuth("a");
    const resolveRole = vi.fn(async () => "admin");
    render(
      <OidcIdentityBridge resolveRole={resolveRole}>
        <Probe />
      </OidcIdentityBridge>,
    );
    await waitFor(() => expect(screen.getByTestId("role").textContent).toBe("admin"));
    expect(resolveRole).toHaveBeenCalledWith({ iss: "https://kc/realms/r", sub: "u1" });
  });

  it("F4: without a resolver the role is null and no product endpoint is called", async () => {
    authHolder.auth = makeAuth("a");
    render(
      <OidcIdentityBridge>
        <Probe />
      </OidcIdentityBridge>,
    );
    await act(async () => {});
    expect(screen.getByTestId("role").textContent).toBe("null");
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes("/api/plugins/"))).toEqual([]);
  });

  it("a failing resolver yields role null (never a role)", async () => {
    authHolder.auth = makeAuth("a");
    render(
      <OidcIdentityBridge resolveRole={async () => Promise.reject(new Error("down"))}>
        <Probe />
      </OidcIdentityBridge>,
    );
    await act(async () => {});
    expect(screen.getByTestId("role").textContent).toBe("null");
  });
});

describe("OidcIdentityBridge (none mode)", () => {
  it("F3: renders as the local operator and never starts a sign-in", async () => {
    setIdentityMode("none");
    authHolder.auth = makeAuth(null);
    const resolveRole = vi.fn(async () => "admin");
    render(
      <OidcIdentityBridge resolveRole={resolveRole}>
        <Probe />
      </OidcIdentityBridge>,
    );
    await waitFor(() => expect(screen.getByTestId("role").textContent).toBe("admin"));
    expect(seen?.mode).toBe("none");
    expect(seen?.authenticated).toBe(true);
    expect(seen?.operator).toEqual(LOCAL_OPERATOR);
    act(() => seen?.signIn());
    expect(authHolder.auth.signinRedirect).not.toHaveBeenCalled();
  });
});
