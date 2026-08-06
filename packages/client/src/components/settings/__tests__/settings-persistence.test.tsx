import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../SettingsPanel.js";

// Persistence behaviour after the reorganisation: debugTools now commits
// through the buffered display-prefs draft source instead of the deleted
// instant-apply toggle (D7), dashboardName is attributed to General, and a
// failing save must never present a false-clean panel.
// See change: reorganize-settings-pages-and-descriptions.
// test-plan #F10, #F15, #F18, #F19, #X1, #X2, #X3.

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
  autoShutdown: false, // off so the gated idle field renders disabled-by-absence
  shutdownIdleSeconds: 300,
  spawnStrategy: "headless",
  dashboardName: "",
  tunnel: { enabled: true, watchdog: { enabled: true, intervalMs: 30000, failureThreshold: 3, probeTimeoutMs: 5000 } },
  devBuildOnReload: false,
  memoryLimits: { maxEventsPerSession: 200, maxStringFieldSize: 4000, maxWsBufferBytes: 4194304 },
};

type Calls = { url: string; method?: string; body?: any };
let calls: Calls[] = [];

/** configPut / prefsPatch let a single test inject a fault into one leg. */
function mockFetch(opts: { configPut?: () => Promise<any>; prefsPatch?: () => Promise<any> } = {}) {
  return vi.fn().mockImplementation((url: string, options?: any) => {
    calls.push({ url, method: options?.method, body: options?.body ? JSON.parse(options.body) : undefined });
    if (url === "/api/config" && !options?.method) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: mockConfig }) });
    }
    if (url === "/api/config" && options?.method === "PUT") {
      return opts.configPut ? opts.configPut() : Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
    }
    if (url === "/api/preferences/display") {
      return opts.prefsPatch ? opts.prefsPatch() : Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  });
}

const gotoPage = (name: string) =>
  fireEvent.click(within(screen.getByTestId("settings-nav-rail")).getByRole("button", { name }));

const prefsPatches = () => calls.filter((c) => c.url === "/api/preferences/display" && c.method === "PATCH");
const configPuts = () => calls.filter((c) => c.url === "/api/config" && c.method === "PUT");

async function openPanel() {
  render(<SettingsPanel />);
  await waitFor(() => screen.getByText("Interface"));
}

/** Toggle a ToggleField by its visible label. */
function toggle(label: string | RegExp) {
  fireEvent.click(screen.getByText(label).closest("div")!.querySelector("button")!);
}

describe("settings persistence after the reorganisation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    calls = [];
    fetchAutoInitWorktreePref.mockResolvedValue(false);
    setAutoInitWorktreePref.mockResolvedValue(true);
    window.history.replaceState({}, "", "/settings/general");
    global.fetch = mockFetch();
  });
  afterEach(() => cleanup());

  // test-plan #F15 — the whole point of deleting the instant-apply toggle.
  it("buffers a debug-events toggle instead of PATCHing immediately", async () => {
    await openPanel();
    toggle("Debug events");

    // No write yet — the old DebugToolsToggle would have PATCHed here.
    expect(prefsPatches()).toHaveLength(0);

    const saveBar = await waitFor(() => screen.getByTestId("settings-save-bar"));
    expect(within(saveBar).getByRole("button", { name: "General" })).toBeTruthy();

    fireEvent.click(screen.getByTestId("save-btn"));
    await waitFor(() => expect(prefsPatches()).toHaveLength(1));
    expect(prefsPatches()[0].body.debugTools).toBe(true);
  });

  // test-plan #F18 — partial.tunnel is one top-level key, attributed to Server.
  it("attributes a watchdog edit to the Server chip", async () => {
    await openPanel();
    gotoPage("Server");
    await waitFor(() => screen.getByText("Memory Limits"));

    toggle(/Enable Watchdog/i);

    const saveBar = await waitFor(() => screen.getByTestId("settings-save-bar"));
    expect(within(saveBar).getByRole("button", { name: "Server" })).toBeTruthy();
  });

  // test-plan #F19 — the leave guard still sees the relocated key.
  it("keeps the panel dirty-guarded after dashboardName moved to General", async () => {
    await openPanel();

    const input = screen.getByText("PWA Display Name").closest("div")!.querySelector("input")!;
    fireEvent.change(input, { target: { value: "laptop" } });
    await waitFor(() => screen.getByTestId("settings-save-bar"));

    // Panel-global isDirty drives the guard; the page move must not bypass it.
    // Header Back is the first button in the header.
    fireEvent.click(within(screen.getByTestId("settings-header")).getAllByRole("button")[0]);

    await waitFor(() => screen.getByTestId("unsaved-changes-dialog"));
    fireEvent.click(screen.getByTestId("unsaved-cancel"));
    await waitFor(() => expect(screen.queryByTestId("unsaved-changes-dialog")).toBeNull());
    expect(screen.getByTestId("settings-save-bar")).toBeTruthy();
  });

  // test-plan #X1
  it("stays dirty and keeps the General chip when the config save fails", async () => {
    global.fetch = mockFetch({ configPut: () => Promise.resolve({ ok: false, json: () => Promise.resolve({ success: false, error: "boom" }) }) });
    await openPanel();

    const input = screen.getByText("PWA Display Name").closest("div")!.querySelector("input")!;
    fireEvent.change(input, { target: { value: "laptop" } });
    fireEvent.click(await waitFor(() => screen.getByTestId("save-btn")));

    await waitFor(() => expect(configPuts()).toHaveLength(1));
    // No false-clean: the bar is still there, still naming General.
    const saveBar = await waitFor(() => screen.getByTestId("settings-save-bar"));
    expect(within(saveBar).getByRole("button", { name: "General" })).toBeTruthy();
  });

  // test-plan #X2
  it("does not double-submit while a save is in flight", async () => {
    let release!: () => void;
    const stalled = new Promise<any>((res) => { release = () => res({ ok: true, json: () => Promise.resolve({ success: true }) }); });
    global.fetch = mockFetch({ configPut: () => stalled });
    await openPanel();

    const input = screen.getByText("PWA Display Name").closest("div")!.querySelector("input")!;
    fireEvent.change(input, { target: { value: "laptop" } });

    const btn = await waitFor(() => screen.getByTestId("save-btn"));
    fireEvent.click(btn);
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(btn); // second click must be inert

    release();
    await waitFor(() => expect(configPuts()).toHaveLength(1));
  });

  // test-plan #X3 — the buffered path must not lose what instant-apply wrote.
  it("does not silently drop debug-events when the prefs save fails", async () => {
    global.fetch = mockFetch({ prefsPatch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({ success: false }) }) });
    await openPanel();

    toggle("Debug events");
    fireEvent.click(await waitFor(() => screen.getByTestId("save-btn")));

    await waitFor(() => expect(prefsPatches()).toHaveLength(1));
    // The failed leg must leave the panel dirty rather than looking saved.
    expect(await waitFor(() => screen.getByTestId("settings-save-bar"))).toBeTruthy();
  });
});
