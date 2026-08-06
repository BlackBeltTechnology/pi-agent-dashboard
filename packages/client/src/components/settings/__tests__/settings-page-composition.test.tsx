import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../SettingsPanel.js";

// Page -> section -> field composition after the settings reorganisation.
// Harness glue copied from ../../__tests__/SettingsPanel.test.tsx.
// See change: reorganize-settings-pages-and-descriptions.

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
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  });
}

function setPath(path: string) {
  window.history.replaceState({}, "", path);
}

function gotoPage(name: string) {
  const rail = screen.getByTestId("settings-nav-rail");
  fireEvent.click(within(rail).getByRole("button", { name }));
}

describe("settings page composition", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchAutoInitWorktreePref.mockResolvedValue(false);
    setAutoInitWorktreePref.mockResolvedValue(true);
    setPath("/settings/general");
    global.fetch = mockFetchConfig();
  });

  afterEach(() => cleanup());

  // test-plan #F5
  it("renders PWA Display Name on General and not on Sessions", async () => {
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));

    expect(screen.getByText("PWA Display Name")).toBeTruthy();

    // Wait on a control unique to the Sessions page — "Sessions" itself matches
    // both the nav-rail button and the section heading.
    gotoPage("Sessions");
    await waitFor(() => screen.getByText(/Session Strategy/i));
    expect(screen.queryByText("PWA Display Name")).toBeNull();
  });

  // test-plan #F17
  it("editing PWA Display Name marks General dirty, not Sessions", async () => {
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));

    const label = screen.getByText("PWA Display Name");
    const input = label.closest("div")!.querySelector("input")!;
    fireEvent.change(input, { target: { value: "laptop" } });

    const saveBar = await waitFor(() => screen.getByTestId("settings-save-bar"));
    expect(within(saveBar).getByRole("button", { name: "General" })).toBeTruthy();
    expect(within(saveBar).queryByRole("button", { name: "Sessions" })).toBeNull();
  });

  // test-plan #F14 — the duplicate instant-apply toggle is gone (D7).
  it("has exactly one debug-events control across the whole panel", async () => {
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));

    const pages = ["General", "Server", "Sessions", "OpenSpec", "Developer"];
    let total = 0;
    for (const page of pages) {
      gotoPage(page);
      await waitFor(() => screen.getByTestId("settings-nav-rail"));
      total += screen.queryAllByText(/^Debug events$/).length;
      // the old Developer control's label must be gone entirely
      expect(screen.queryByText(/Show debug events/)).toBeNull();
    }
    expect(total).toBe(1);
  });

  // test-plan #F12
  it("keeps chat-display on General only, with no Developer chat-display section", async () => {
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));
    expect(screen.getByText(/Chat display/i)).toBeTruthy();

    gotoPage("Developer");
    await waitFor(() => screen.getByText("Dev Build on Reload"));
    expect(screen.queryByText(/Chat Display/i)).toBeNull();
  });

  // test-plan #F6 — D2 dropped the Gateway move; this guards the reversal.
  it("keeps the tunnel watchdog fields on Server", async () => {
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));

    gotoPage("Server");
    await waitFor(() => screen.getByText("Memory Limits"));
    expect(screen.getByText(/Enable Watchdog/i)).toBeTruthy();
  });
});
