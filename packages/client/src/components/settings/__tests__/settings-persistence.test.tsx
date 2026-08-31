import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../SettingsPanel.js";
import { PROVIDER_AUTH_EVENT, useProvidersReady } from "../../../hooks/useProvidersReady.js";

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

/**
 * Toggle a ToggleField by its visible label.
 *
 * Waits for the control to exist first: under full-suite contention the
 * section's effects settle later than the "Interface" heading that openPanel
 * waits on, and clicking too early leaves the draft source clean — which
 * surfaced as a save bar that never appeared.
 */
async function toggle(label: string | RegExp) {
  const btn = await waitFor(() => {
    const found = screen.getByText(label).closest("div")?.querySelector("button");
    if (!found) throw new Error(`no toggle button for ${label}`);
    return found;
  });
  fireEvent.click(btn);
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
    await toggle("Debug events");

    // No write yet — the old DebugToolsToggle would have PATCHed here.
    expect(prefsPatches()).toHaveLength(0);

    const saveBar = await waitFor(() => screen.getByTestId("settings-save-bar"));
    expect(within(saveBar).getByRole("button", { name: "General" })).toBeTruthy();

    fireEvent.click(screen.getByTestId("save-btn"));
    await waitFor(() => expect(prefsPatches()).toHaveLength(1));
    expect(prefsPatches()[0].body.debugTools).toBe(true);
  });

  // ── gate-notify-rows-by-level ──────────────────────────────────────────
  // 2.30 / test-plan #F8 — exactly one control, on General.
  it("renders exactly one notifyMinLevel control, on the General page", async () => {
    await openPanel();
    const selects = await waitFor(() => {
      const found = Array.from(
        document.querySelectorAll<HTMLSelectElement>("select"),
      ).filter((el) =>
        Array.from(el.options).map((o) => o.value).join(",") ===
        "all,success,warnings,errors"
      );
      if (found.length === 0) throw new Error("notifyMinLevel select not rendered");
      return found;
    });
    expect(selects).toHaveLength(1);

    // It is not duplicated onto any other page.
    for (const page of ["Server", "Sessions"]) {
      gotoPage(page);
      const onOther = Array.from(
        document.querySelectorAll<HTMLSelectElement>("select"),
      ).filter((el) =>
        Array.from(el.options).map((o) => o.value).join(",") ===
        "all,success,warnings,errors"
      );
      expect(onOther, `duplicated on ${page}`).toHaveLength(0);
    }
  });

  // 2.31 / test-plan #F9 — buffered through the display-prefs draft source.
  it("buffers a notify-level change and persists it only on Save", async () => {
    await openPanel();
    const select = await waitFor(() => {
      const found = Array.from(
        document.querySelectorAll<HTMLSelectElement>("select"),
      ).find((el) =>
        Array.from(el.options).map((o) => o.value).join(",") ===
        "all,success,warnings,errors"
      );
      if (!found) throw new Error("notifyMinLevel select not rendered");
      return found;
    });

    fireEvent.change(select, { target: { value: "warnings" } });

    // Buffered — nothing written yet.
    expect(prefsPatches()).toHaveLength(0);

    // …and it dirties General, like its ToggleField neighbours.
    const saveBar = await waitFor(() => screen.getByTestId("settings-save-bar"));
    expect(within(saveBar).getByRole("button", { name: "General" })).toBeTruthy();

    fireEvent.click(screen.getByTestId("save-btn"));
    await waitFor(() => expect(prefsPatches()).toHaveLength(1));
    expect(prefsPatches()[0].body.notifyMinLevel).toBe("warnings");
  });

  // test-plan #F18 — partial.tunnel is one top-level key, attributed to Server.
  it("attributes a watchdog edit to the Server chip", async () => {
    await openPanel();
    gotoPage("Server");
    await waitFor(() => screen.getByText("Memory Limits"));

    await toggle(/Enable Watchdog/i);

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

    await toggle("Debug events");
    fireEvent.click(await waitFor(() => screen.getByTestId("save-btn")));

    await waitFor(() => expect(prefsPatches()).toHaveLength(1));
    // The failed leg must leave the panel dirty rather than looking saved.
    expect(await waitFor(() => screen.getByTestId("settings-save-bar"))).toBeTruthy();
  });
});

// ── dispatch-provider-auth-event ─────────────────────────────────────────────
// The custom-LLM-provider `PUT /api/providers` has REPLACE semantics, so one
// success-path dispatch (placed after the `data.success` guard) covers add,
// edit and delete. test-plan #D4, #E3, #E4, #X2 of change
// dispatch-provider-auth-event.

function ReadyProbe() {
  const state = useProvidersReady();
  return <div data-testid="providers-ready">{JSON.stringify(state)}</div>;
}

interface ProviderCtl {
  providers: Record<string, any>;
  providersPut?: () => Promise<any>;
}
let pc: ProviderCtl;
let providerCalls: Calls[];

function stubProviderFetch() {
  global.fetch = vi.fn(async (url: string, options?: any) => {
    providerCalls.push({ url, method: options?.method, body: options?.body ? JSON.parse(options.body) : undefined });
    if (url.includes("/api/provider-auth/handlers")) return { ok: true, json: async () => ({ ids: [] }) } as any;
    if (url.includes("/api/provider-auth/status")) return { ok: true, json: async () => [] } as any;
    if (url.includes("/api/models")) return { ok: true, json: async () => ({ status: "ok", models: [] }) } as any;
    if (url === "/api/config" && !options?.method) return { ok: true, json: async () => ({ success: true, data: mockConfig }) } as any;
    if (url === "/api/config" && options?.method === "PUT") return { ok: true, json: async () => ({ success: true }) } as any;
    if (url.includes("/api/providers") && options?.method === "PUT") return pc.providersPut ? await pc.providersPut() : { ok: true, json: async () => ({ success: true }) } as any;
    if (url.includes("/api/providers")) return { ok: true, json: async () => ({ success: true, providers: pc.providers, health: {} }) } as any;
    if (url.includes("/api/preferences/display")) return { ok: true, json: async () => ({ success: true }) } as any;
    return { ok: false, json: async () => null } as any;
  }) as any;
}

function trackProviderEvents() {
  const events: CustomEvent[] = [];
  const onEvent = (e: Event) => events.push(e as CustomEvent);
  window.addEventListener(PROVIDER_AUTH_EVENT, onEvent);
  return { events, stop: () => window.removeEventListener(PROVIDER_AUTH_EVENT, onEvent) };
}

const providersPuts = () => providerCalls.filter((c) => c.url.includes("/api/providers") && c.method === "PUT");

async function openPanelOnProviders(probe = false) {
  render(probe ? <><SettingsPanel /><ReadyProbe /></> : <SettingsPanel />);
  await waitFor(() => screen.getByText("Interface"));
  gotoPage("Providers");
}

describe("settings panel — custom-provider writes dispatch provider-auth-event", () => {
  beforeEach(() => {
    pc = { providers: {} };
    providerCalls = [];
    window.history.replaceState({}, "", "/settings/general");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("D4 dispatches one event on a custom-provider save", async () => {
    stubProviderFetch();
    const { events, stop } = trackProviderEvents();
    await openPanelOnProviders();

    fireEvent.click(await screen.findByText("Add Provider"));
    fireEvent.change(screen.getByPlaceholderText("Provider name"), { target: { value: "custom-llm" } });
    fireEvent.change(screen.getByText("Base URL").closest("div")!.querySelector("input")!, { target: { value: "https://api.example.com/v1" } });
    fireEvent.change(screen.getByPlaceholderText("sk-... or $ENV_VAR_NAME"), { target: { value: "sk-custom" } });
    await waitFor(() => screen.getByTestId("settings-save-bar"));
    fireEvent.click(screen.getByTestId("save-btn"));

    await waitFor(() => expect(providersPuts()).toHaveLength(1));
    expect(providersPuts()[0].body.providers["custom-llm"].apiKey).toBe("sk-custom");
    await waitFor(() => expect(events).toHaveLength(1));
    stop();
  });

  it("E3 dispatches when a custom provider is deleted via the replace PUT", async () => {
    pc = { providers: { "custom-llm": { baseUrl: "https://api.example.com/v1", apiKey: "sk-real", api: "openai" } } };
    stubProviderFetch();
    const { events, stop } = trackProviderEvents();
    await openPanelOnProviders();

    fireEvent.click(await screen.findByText("Remove"));
    await waitFor(() => screen.getByTestId("settings-save-bar"));
    fireEvent.click(screen.getByTestId("save-btn"));

    await waitFor(() => expect(events).toHaveLength(1));
    expect(providersPuts()[0].body.providers).toEqual({});
    stop();
  });

  it("E4 a base-URL-only edit of a sentinel-keyed provider still dispatches, readiness unchanged", async () => {
    // "***" is the redaction sentinel — the key round-trips untouched, so the
    // provider is keyed before AND after. Over-dispatch is legal (#E4).
    pc = { providers: { "custom-llm": { baseUrl: "https://api.example.com/v1", apiKey: "***", api: "openai" } } };
    stubProviderFetch();
    const { events, stop } = trackProviderEvents();
    await openPanelOnProviders(true);
    const probe = () => JSON.parse(screen.getByTestId("providers-ready").textContent!);
    await waitFor(() => expect(probe().ready).toBe(true));

    fireEvent.change(screen.getByText("Base URL").closest("div")!.querySelector("input")!, { target: { value: "https://api2.example.com/v1" } });
    await waitFor(() => screen.getByTestId("settings-save-bar"));
    fireEvent.click(screen.getByTestId("save-btn"));

    await waitFor(() => expect(events).toHaveLength(1));
    await waitFor(() => expect(probe().loading).toBe(false));
    expect(probe().ready).toBe(true);
    stop();
  });

  it("X2 a body-level failure dispatches nothing", async () => {
    pc = { providers: {}, providersPut: async () => ({ ok: true, json: async () => ({ success: false, error: "providers boom" }) }) };
    stubProviderFetch();
    const { events, stop } = trackProviderEvents();
    await openPanelOnProviders();

    fireEvent.click(await screen.findByText("Add Provider"));
    fireEvent.change(screen.getByPlaceholderText("Provider name"), { target: { value: "custom-llm" } });
    await waitFor(() => screen.getByTestId("settings-save-bar"));
    fireEvent.click(screen.getByTestId("save-btn"));

    await waitFor(() => expect(providersPuts()).toHaveLength(1));
    expect(events).toHaveLength(0);
    stop();
  });
});
