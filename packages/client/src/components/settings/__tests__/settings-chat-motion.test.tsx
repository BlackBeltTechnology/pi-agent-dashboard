/**
 * SettingsPanel — the `chatMotion` chat-display toggle (task 1.3).
 * Harness glue copied from settings-chat-display-new-controls.test.tsx.
 * See change: add-fluid-chat-motion.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../SettingsPanel.js";

const { fetchAutoInitWorktreePref, setAutoInitWorktreePref } = vi.hoisted(() => ({
  fetchAutoInitWorktreePref: vi.fn(),
  setAutoInitWorktreePref: vi.fn(),
}));
vi.mock("../../../lib/git/git-api.js", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/git/git-api.js")>("../../../lib/git/git-api.js");
  return { ...actual, fetchAutoInitWorktreePref, setAutoInitWorktreePref };
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

function mockFetchConfig() {
  return vi.fn().mockImplementation((url: string, options?: any) => {
    if (url === "/api/config" && !options?.method) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: mockConfig }) });
    }
    if (url === "/api/config" && options?.method === "PUT") {
      return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
    }
    if (url === "/api/custom-event-groups" && !options?.method) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            groups: [
              { id: "memory", label: "Memory telemetry", default: false },
              { id: "search", label: "Web search results", default: true },
              { id: "other", label: "Catch-all other", default: true },
            ],
          }),
      });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  });
}


function chatDisplayPage() {
  render(<SettingsPanel />);
  return waitFor(() => screen.getByText("Interface")).then(() => {
    const rail = screen.getByTestId("settings-nav-rail");
    fireEvent.click(within(rail).getByRole("button", { name: "General" }));
    return waitFor(() => screen.getByText(/Chat display/i));
  });
}

describe("settings chat-display — chatMotion toggle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchAutoInitWorktreePref.mockResolvedValue(false);
    setAutoInitWorktreePref.mockResolvedValue(true);
    window.history.replaceState({}, "", "/settings/general");
    global.fetch = mockFetchConfig();
  });

  afterEach(() => cleanup());

  it("renders the toggle on by default and flips it", async () => {
    await chatDisplayPage();
    const toggle = screen.getByRole("switch", { name: "Fluid chat motion" }) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.disabled).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(
        (screen.getByRole("switch", { name: "Fluid chat motion" }) as HTMLButtonElement).getAttribute("aria-checked"),
      ).toBe("false"),
    );
  });
});
