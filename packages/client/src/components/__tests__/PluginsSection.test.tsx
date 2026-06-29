/**
 * Tests for the Plugins activation tab.
 * See change: add-plugin-activation-ui.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { PluginsSection } from "../PluginsSection.js";

vi.mock("../../hooks/usePackageOperations.js", () => ({
  usePackageOperations: () => ({
    install: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
    statusFor: () => "idle",
    messageFor: () => "",
  }),
}));

vi.mock("../../lib/api-context.js", () => ({
  getApiBase: () => "",
}));

// PluginSettingsHost renders the plugin's settings-section claims via the
// slot registry. We don't need a real registry for these tests — just check
// the host element is mounted on expand.
vi.mock("../PluginSettingsHost.js", () => ({
  PluginSettingsHost: ({ pluginId }: { pluginId: string }) => (
    <div data-testid={`plugin-settings-host-${pluginId}`}>settings for {pluginId}</div>
  ),
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

    render(<PluginsSection />);

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

    render(<PluginsSection />);

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

  it("expanding a row mounts PluginSettingsHost", async () => {
    const { fetchImpl } = makeFetchSequence([
      { url: /\/api\/plugins$/, body: { success: true, plugins: [pluginRow()] } },
      { url: /\/api\/health/, body: { ok: true, startedAt: "2025-01-01T00:00:00Z", plugins: [] } },
    ]);
    vi.stubGlobal("fetch", fetchImpl);

    render(<PluginsSection />);

    const chevron = await screen.findByTestId("plugin-expand-demo");
    fireEvent.click(chevron);
    expect(screen.getByTestId("plugin-settings-host-demo")).toBeTruthy();
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

    render(<PluginsSection />);

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

    render(<PluginsSection />);

    expect(await screen.findByTestId("install-piExtension-link-some-unknown-extension")).toBeTruthy();
    expect(screen.queryByTestId("install-piExtension-some-unknown-extension")).toBeNull();
  });
});
