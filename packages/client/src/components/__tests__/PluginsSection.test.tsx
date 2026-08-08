/**
 * Tests for the Plugins activation tab.
 * See change: add-plugin-activation-ui.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePluginList, usePluginToggle } from "../../hooks/usePluginToggle.js";
import { PluginsSection } from "../packages/PluginsSection.js";

// PluginsSection takes its list/toggle from SettingsPanel so the index and the
// nav rail share one fetch and one desired-state overlay. This harness mounts
// the real hooks so the tests still exercise the true fetch/toggle path.
// See change: plugin-settings-pages.
function MountedPluginsSection() {
  const list = usePluginList();
  const toggle = usePluginToggle(list);
  // Same predicate SettingsPanel supplies (claims OR intent).
  const contributesSettings = (row: { claims: { slot: string }[] }) =>
    row.claims.some((c) => c.slot === "settings-section");
  return (
    <PluginsSection
      list={list}
      toggle={toggle}
      contributesSettings={contributesSettings as never}
    />
  );
}

vi.mock("../../hooks/usePackageOperations.js", () => ({
  usePackageOperations: () => ({
    install: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
    statusFor: () => "idle",
    messageFor: () => "",
  }),
}));

vi.mock("../../lib/api/api-context.js", () => ({
  getApiBase: () => "",
}));

// The cog navigates instead of expanding inline, so capture wouter's navigate.
const navigateSpy = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/settings/plugins", navigateSpy],
}));

function makeFetchSequence(responses: Array<{ url: RegExp; body: any; status?: number }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const match = responses.find((r) => r.url.test(url));
    if (!match) {
      return new Response(JSON.stringify({ success: false }), { status: 404 });
    }
    return new Response(JSON.stringify(match.body), { status: match.status ?? 200 });
  });
  return { fetchImpl, calls };
}

function pluginRow(over: any = {}) {
  return {
    id: "demo",
    displayName: "Demo Plugin",
    priority: 100,
    hasServer: false,
    hasBridge: false,
    hasClient: true,
    claims: [{ slot: "settings-section", component: "DemoSettings" }],
    requires: null,
    status: {
      id: "demo",
      displayName: "Demo Plugin",
      enabled: true,
      loaded: true,
      claims: 1,
      missingRequirements: [],
    },
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PluginsSection", () => {
  it("renders one row per discovered plugin", async () => {
    const { fetchImpl } = makeFetchSequence([
      { url: /\/api\/plugins$/, body: { success: true, plugins: [pluginRow()] } },
      { url: /\/api\/health/, body: { ok: true, startedAt: "2025-01-01T00:00:00Z", plugins: [] } },
    ]);
    vi.stubGlobal("fetch", fetchImpl);

    render(<MountedPluginsSection />);

    expect(await screen.findByTestId("plugin-row-demo")).toBeTruthy();
    expect(screen.getByText("Demo Plugin")).toBeTruthy();
  });

  it("toggle posts to /api/plugins/:id/toggle and shows the restart banner", async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      if (/\/api\/plugins$/.test(url)) {
        return new Response(
          JSON.stringify({ success: true, plugins: [pluginRow()] }),
          { status: 200 },
        );
      }
      if (/\/api\/health/.test(url)) {
        return new Response(
          JSON.stringify({ ok: true, startedAt: "2025-01-01T00:00:00Z", plugins: [] }),
          { status: 200 },
        );
      }
      if (/\/api\/plugins\/demo\/toggle/.test(url)) {
        return new Response(JSON.stringify({ success: true, restartRequired: true }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchImpl);

    render(<MountedPluginsSection />);

    const toggle = await screen.findByTestId("plugin-toggle-demo");
    fireEvent.click(toggle);

    // Should have POSTed to the toggle endpoint.
    const togglePost = fetchCalls.find((c) => /\/api\/plugins\/demo\/toggle/.test(c.url));
    expect(togglePost).toBeTruthy();
    expect(togglePost?.init?.method).toBe("POST");

    // Banner appears.
    await waitFor(() => {
      expect(screen.queryByTestId("plugins-restart-required-banner")).toBeTruthy();
    });
  });

  it("the settings cog navigates to the plugin page instead of expanding inline", async () => {
    const { fetchImpl } = makeFetchSequence([
      { url: /\/api\/plugins$/, body: { success: true, plugins: [pluginRow()] } },
      { url: /\/api\/health/, body: { ok: true, startedAt: "2025-01-01T00:00:00Z", plugins: [] } },
    ]);
    vi.stubGlobal("fetch", fetchImpl);

    render(<MountedPluginsSection />);

    const cog = await screen.findByTestId("plugin-expand-demo");
    fireEvent.click(cog);
    expect(navigateSpy).toHaveBeenCalledWith("/settings/plugins/demo");
    // No inline settings body is mounted on the activation index.
    expect(screen.queryByTestId("plugin-settings-demo")).toBeNull();
  });

  it("missing piExtensions render warning with inline Install button when recommended", async () => {
    const row = pluginRow({
      status: {
        id: "demo",
        displayName: "Demo Plugin",
        enabled: true,
        loaded: true,
        claims: 1,
        requirements: {
          piExtensions: [{ name: "pi-web-access", satisfied: false }],
          binaries: [],
          services: [],
        },
        missingRequirements: ["pi-web-access"],
      },
    });
    const { fetchImpl } = makeFetchSequence([
      { url: /\/api\/plugins$/, body: { success: true, plugins: [row] } },
      { url: /\/api\/health/, body: { ok: true, startedAt: "2025-01-01T00:00:00Z", plugins: [] } },
    ]);
    vi.stubGlobal("fetch", fetchImpl);

    render(<MountedPluginsSection />);

    expect(await screen.findByTestId("missing-piExtension-pi-web-access")).toBeTruthy();
    // pi-web-access is in RECOMMENDED_EXTENSIONS so the inline Install button appears.
    expect(screen.getByTestId("install-piExtension-pi-web-access")).toBeTruthy();
  });

  it("missing piExtensions without a recommended match render the fallback link", async () => {
    const row = pluginRow({
      status: {
        id: "demo",
        displayName: "Demo Plugin",
        enabled: true,
        loaded: true,
        claims: 1,
        requirements: {
          piExtensions: [{ name: "some-unknown-extension", satisfied: false }],
          binaries: [],
          services: [],
        },
        missingRequirements: ["some-unknown-extension"],
      },
    });
    const { fetchImpl } = makeFetchSequence([
      { url: /\/api\/plugins$/, body: { success: true, plugins: [row] } },
      { url: /\/api\/health/, body: { ok: true, startedAt: "2025-01-01T00:00:00Z", plugins: [] } },
    ]);
    vi.stubGlobal("fetch", fetchImpl);

    render(<MountedPluginsSection />);

    expect(await screen.findByTestId("install-piExtension-link-some-unknown-extension")).toBeTruthy();
    expect(screen.queryByTestId("install-piExtension-some-unknown-extension")).toBeNull();
  });
});
