/**
 * Settings → Sessions → Worktrees: the Windows "Bash for agent commands" select
 * next to "Git & Bash source". Visible only when /api/health carries a
 * `gitSource` readout (Windows); saves `windowsBashSource` and re-fetches the
 * readout.
 *
 * See change: fix-windows-bundled-bash-exe (test-plan #E29 #E30 #E31).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../settings/SettingsPanel.js";

const { fetchAutoInitWorktreePref, setAutoInitWorktreePref } = vi.hoisted(() => ({
  fetchAutoInitWorktreePref: vi.fn(),
  setAutoInitWorktreePref: vi.fn(),
}));
vi.mock("../../lib/git/git-api.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/git/git-api.js")>("../../lib/git/git-api.js");
  return { ...actual, fetchAutoInitWorktreePref, setAutoInitWorktreePref };
});
vi.mock("../../lib/api/model-proxy-api.js", () => ({
  listApiKeys: vi.fn().mockResolvedValue({ keys: [], revoked: [] }),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn().mockResolvedValue(undefined),
  deleteApiKey: vi.fn().mockResolvedValue(undefined),
  refreshRegistry: vi.fn().mockResolvedValue(undefined),
}));

const baseConfig = {
  port: 8000,
  piPort: 9999,
  autoStart: true,
  autoShutdown: true,
  shutdownIdleSeconds: 300,
  spawnStrategy: "headless",
  tunnel: { enabled: true },
  devBuildOnReload: false,
  memoryLimits: { maxEventsPerSession: 200, maxStringFieldSize: 4000, maxWsBufferBytes: 4194304 },
};

const readout = {
  setting: "auto",
  source: "host",
  gitPath: "C:\\Program Files\\Git\\cmd\\git.exe",
  gitVersion: "git version 2.53.0.windows.4",
  shellPath: "C:\\Program Files\\Git\\bin\\bash.exe",
  bashSetting: "bundled",
  shellIsWslLauncher: false,
};

function mockFetch(opts: { gitSource: unknown; config?: Record<string, unknown>; onPut?: (body: any) => void }) {
  return vi.fn().mockImplementation((url: string, options?: any) => {
    if (url.endsWith("/api/config") && options?.method === "PUT") {
      opts.onPut?.(JSON.parse(options.body));
      return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
    }
    if (url.endsWith("/api/config")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: { ...baseConfig, ...opts.config } }) });
    }
    if (url.endsWith("/api/health")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ gitSource: opts.gitSource }) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  });
}

function gotoSessions() {
  const rail = screen.getByTestId("settings-nav-rail");
  fireEvent.click(within(rail).getByRole("button", { name: "Sessions" }));
}

describe("SettingsPanel — Windows bash source", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchAutoInitWorktreePref.mockResolvedValue(false);
    setAutoInitWorktreePref.mockResolvedValue(true);
    window.history.replaceState({}, "", "/settings/general");
  });
  afterEach(() => cleanup());

  it("E29: readout present → select shown + enabled, hint explains the bundled-only PATH effect, readout shows shellPath", async () => {
    global.fetch = mockFetch({ gitSource: readout });
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));
    gotoSessions();

    const select = (await screen.findByLabelText("Bash for agent commands")) as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect(select.value).toBe("bundled");
    expect(screen.getByText(/only while the git source is bundled/i)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(readout.shellPath)).toBeTruthy());
  });

  it("E30: no readout (macOS/Linux) → neither Windows select is rendered", async () => {
    global.fetch = mockFetch({ gitSource: null });
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));
    gotoSessions();
    await waitFor(() => screen.getByText("Worktrees"));
    expect(screen.queryByLabelText("Bash for agent commands")).toBeNull();
    expect(screen.queryByLabelText("Git & Bash source (Windows)")).toBeNull();
  });

  it("E31: choosing 'host' and saving PATCHes windowsBashSource and re-fetches the readout", async () => {
    let saved: any;
    const f = mockFetch({ gitSource: readout, config: { windowsBashSource: "bundled" }, onPut: (b) => (saved = b) });
    global.fetch = f;
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));
    gotoSessions();

    const select = await screen.findByLabelText("Bash for agent commands");
    const healthCallsBefore = f.mock.calls.filter(([u]) => String(u).endsWith("/api/health")).length;
    fireEvent.change(select, { target: { value: "host" } });
    fireEvent.click(screen.getAllByTestId("save-btn")[0]);

    await waitFor(() => expect(saved?.windowsBashSource).toBe("host"));
    await waitFor(() =>
      expect(f.mock.calls.filter(([u]) => String(u).endsWith("/api/health")).length).toBeGreaterThan(healthCallsBefore),
    );
  });
});
