import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLUGIN_INTERNALS_KEY } from "../../../lib/state/plugin-internals-pref.js";
import { SettingsPanel } from "../SettingsPanel.js";

// Developer ▸ "Show plugin internals": per-browser localStorage preference.
// Harness glue copied from settings-page-composition.test.tsx.
// See change: retro-ux-plugin-settings-wave-2 (test-plan #E29).

vi.mock("../../../lib/git/git-api.js", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/git/git-api.js")>("../../../lib/git/git-api.js");
  return {
    ...actual,
    fetchAutoInitWorktreePref: vi.fn().mockResolvedValue(false),
    setAutoInitWorktreePref: vi.fn().mockResolvedValue(true),
  };
});
vi.mock("../../../lib/api/model-proxy-api.js", () => ({
  listApiKeys: vi.fn().mockResolvedValue({ keys: [], revoked: [] }),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn().mockResolvedValue(undefined),
  deleteApiKey: vi.fn().mockResolvedValue(undefined),
  refreshRegistry: vi.fn().mockResolvedValue(undefined),
}));

const mockConfig = {
  port: 8000,
  piPort: 9999,
  autoStart: true,
  autoShutdown: true,
  shutdownIdleSeconds: 300,
  spawnStrategy: "headless",
  tunnel: { enabled: true, watchdog: { enabled: true, intervalMs: 30000, failureThreshold: 3, probeTimeoutMs: 5000 } },
  devBuildOnReload: false,
  dashboardName: "",
  memoryLimits: { maxEventsPerSession: 200, maxStringFieldSize: 4000, maxWsBufferBytes: 4194304 },
};

/** In-memory localStorage: Node's experimental global shadows jsdom's under some runners. */
function installLocalStorage() {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  });
  Object.defineProperty(window, "localStorage", { value: globalThis.localStorage, configurable: true });
}

let fetchSpy: ReturnType<typeof vi.fn>;

describe("Developer page — Show plugin internals (#E29)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installLocalStorage();
    window.history.replaceState({}, "", "/settings/developer");
    fetchSpy = vi.fn().mockImplementation((url: string, options?: { method?: string }) => {
      if (url === "/api/config" && !options?.method) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: mockConfig }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("is off by default, turns on in localStorage, and never writes dashboard config", async () => {
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Dev Build on Reload"));

    const sw = screen.getByRole("switch", { name: "Show plugin internals" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(localStorage.getItem(PLUGIN_INTERNALS_KEY)).not.toBe("true");

    fireEvent.click(sw);
    expect(screen.getByRole("switch", { name: "Show plugin internals" }).getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem(PLUGIN_INTERNALS_KEY)).toBe("true");

    // Instant, per-browser: no dirty state, no config write of any kind.
    expect(screen.queryByTestId("settings-save-bar")).toBeNull();
    const writes = fetchSpy.mock.calls.filter(([, o]) => o?.method && o.method !== "GET");
    expect(writes).toEqual([]);

    fireEvent.click(screen.getByRole("switch", { name: "Show plugin internals" }));
    expect(localStorage.getItem(PLUGIN_INTERNALS_KEY)).toBe("false");
  });

  it("reads an existing on value", async () => {
    localStorage.setItem(PLUGIN_INTERNALS_KEY, "true");
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Dev Build on Reload"));
    const content = screen.getByTestId("settings-content");
    expect(within(content).getByRole("switch", { name: "Show plugin internals" }).getAttribute("aria-checked")).toBe("true");
  });
});
