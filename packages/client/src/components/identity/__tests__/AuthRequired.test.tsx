/**
 * D18 — core is a seam only: `AuthRequired` never links to the legacy
 * server-rendered `/auth/login` page. Inactive login plane → static "no
 * sign-in method installed" text; active → Sign in button that mounts the
 * plugin-owned gate (start phase).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("wouter", () => ({ useLocation: () => ["/", navigate] }));

vi.mock("../../../lib/i18n/i18n.js", () => ({
  useI18n: () => ({ t: (_k: string, _v: unknown, fallback: string) => fallback, language: "en" }),
}));

const fetchLoginConfig = vi.fn();
vi.mock("../../../lib/identity/login-config.js", () => ({ fetchLoginConfig: () => fetchLoginConfig() }));

function FakeProvider(props: { phase: string }) {
  return <div data-testid="fake-provider" data-phase={props.phase} />;
}
vi.mock("../../../generated/plugin-registry.js", () => ({
  PLUGIN_REGISTRY: [
    {
      manifest: { id: "keycloak-resolver" },
      claims: [{ slot: "login-provider", pluginId: "keycloak-resolver", Component: FakeProvider }],
    },
  ],
}));

import { AuthRequired } from "../AuthRequired.js";

afterEach(() => {
  cleanup();
  fetchLoginConfig.mockReset();
});

describe("AuthRequired (D18 — no core login UI)", () => {
  it("inactive plane: states no sign-in method is installed — no /auth/login link, no button", async () => {
    fetchLoginConfig.mockResolvedValue({ active: false });
    const { container } = render(<AuthRequired apiBase="" />);
    await waitFor(() => expect(screen.getByText(/no sign-in method/i)).toBeTruthy());
    expect(container.querySelector('a[href*="/auth/login"]')).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("active plane: Sign in button mounts the plugin gate in start phase", async () => {
    fetchLoginConfig.mockResolvedValue({ active: true, pluginId: "keycloak-resolver" });
    render(<AuthRequired apiBase="" />);
    const btn = await screen.findByRole("button", { name: /sign in/i });
    fireEvent.click(btn);
    const provider = await screen.findByTestId("fake-provider");
    expect(provider.getAttribute("data-phase")).toBe("start");
  });

  it("descriptor vanished between banner and click: gate falls back without any /auth/login link", async () => {
    fetchLoginConfig.mockResolvedValueOnce({ active: true, pluginId: "keycloak-resolver" });
    fetchLoginConfig.mockResolvedValue({ active: false });
    const { container } = render(<AuthRequired apiBase="" />);
    const btn = await screen.findByRole("button", { name: /sign in/i });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.queryByTestId("fake-provider")).toBeNull());
    expect(container.querySelector('a[href*="/auth/login"]')).toBeNull();
  });
});
