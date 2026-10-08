import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("wouter", () => ({ useLocation: () => ["/callback", navigate] }));

// i18n: identity strings degrade to their English default.
vi.mock("../../../lib/i18n/i18n.js", () => ({
  useI18n: () => ({ t: (_k: string, _v: unknown, fallback: string) => fallback, language: "en" }),
}));

const fetchLoginConfig = vi.fn();
vi.mock("../../../lib/identity/login-config.js", () => ({ fetchLoginConfig: () => fetchLoginConfig() }));

// A fake login-provider that, in callback phase, immediately hands core a
// return-to — exercising the real gate → onComplete → navigate path (LG-9).
function FakeProvider(props: { phase: string; returnTo: string; onComplete: (rt: string) => void }) {
  React.useEffect(() => {
    if (props.phase === "callback") props.onComplete("/session/abc");
  }, [props]);
  return <div data-testid="fake-provider" data-phase={props.phase} data-returnto={props.returnTo} />;
}
vi.mock("../../../generated/plugin-registry.js", () => ({
  PLUGIN_REGISTRY: [
    { manifest: { id: "keycloak-resolver" }, claims: [{ slot: "login-provider", pluginId: "keycloak-resolver", Component: FakeProvider }] },
  ],
}));

import { LoginGate } from "../LoginGate.js";

// jsdom's location.assign throws "Not implemented" — replace it with a spy so
// the D19 separate-view redirect is observable.
let assignSpy: ReturnType<typeof vi.fn>;
const realLocation = window.location;

beforeEach(() => {
  assignSpy = vi.fn();
  Object.defineProperty(window, "location", {
    value: { origin: "https://dash.example", assign: assignSpy, pathname: "/", search: "" },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  navigate.mockReset();
  fetchLoginConfig.mockReset();
  Object.defineProperty(window, "location", { value: realLocation, writable: true, configurable: true });
});

describe("LoginGate separate-view provider (D19)", () => {
  it("start: a loginUrl redirects the browser there instead of mounting a component", async () => {
    fetchLoginConfig.mockResolvedValue({ active: true, pluginId: "identity-smoke", loginUrl: "/identity-smoke/login" });
    render(<LoginGate phase="start" />);
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith("/identity-smoke/login"));
    expect(screen.queryByTestId("fake-provider")).toBeNull();
  });

  it("logout: a logoutUrl redirects (sign-out never mounts the login component)", async () => {
    fetchLoginConfig.mockResolvedValue({
      active: true,
      pluginId: "identity-smoke",
      loginUrl: "/identity-smoke/login",
      logoutUrl: "/identity-smoke/logout",
    });
    render(<LoginGate phase="logout" />);
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith("/identity-smoke/logout"));
    expect(screen.queryByTestId("fake-provider")).toBeNull();
  });

  it("an OFF-ORIGIN loginUrl is refused (open redirect) and falls through to the component", async () => {
    fetchLoginConfig.mockResolvedValue({ active: true, pluginId: "keycloak-resolver", loginUrl: "https://evil.example/x" });
    render(<LoginGate phase="start" />);
    await waitFor(() => expect(screen.getByTestId("fake-provider")).toBeTruthy());
    expect(assignSpy).not.toHaveBeenCalled();
  });
});

describe("LoginGate logout phase (D18)", () => {
  it("mounts the vouched provider with phase=logout", async () => {
    fetchLoginConfig.mockResolvedValue({ active: true, pluginId: "keycloak-resolver" });
    render(<LoginGate phase="logout" />);
    const el = await screen.findByTestId("fake-provider");
    expect(el.getAttribute("data-phase")).toBe("logout");
  });
});

describe("LoginGate (core-owned mount + nav, D16 / LG-9 / LG-15)", () => {
  it("callback: mounts the vouched provider and navigates to the validated return-to", async () => {
    fetchLoginConfig.mockResolvedValue({ active: true, pluginId: "keycloak-resolver" });
    render(<LoginGate phase="callback" />);
    await waitFor(() => expect(screen.getByTestId("fake-provider")).toBeTruthy());
    expect(screen.getByTestId("fake-provider").getAttribute("data-phase")).toBe("callback");
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/session/abc", { replace: true }));
  });

  it("inactive plane → provider-agnostic fallback, never a provider (LG-15)", async () => {
    fetchLoginConfig.mockResolvedValue({ active: false });
    render(<LoginGate phase="callback" />);
    await waitFor(() => expect(screen.getByText("Sign-in is not available.")).toBeTruthy());
    expect(screen.queryByTestId("fake-provider")).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("active but a caller fallback is supplied for a missing owner → renders that fallback", async () => {
    fetchLoginConfig.mockResolvedValue({ active: true, pluginId: "not-in-registry" });
    render(<LoginGate phase="start" fallback={<span data-testid="legacy">legacy</span>} />);
    await waitFor(() => expect(screen.getByTestId("legacy")).toBeTruthy());
    expect(screen.queryByTestId("fake-provider")).toBeNull();
  });
});
