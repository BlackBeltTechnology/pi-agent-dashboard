/**
 * Heap fields on the Sessions and Server settings pages.
 *
 * Harness glue copied from `settings-page-composition.test.tsx`.
 *
 * Covers: page attribution (#E19), save payload (#E20), entry validation
 * (#E21), effect-boundary copy (#F1), the subagent coupling warning (#E24),
 * the cold-start label (#E31) and the configured-vs-effective divergence
 * indicator (#E32).
 *
 * See change: bound-session-heap-and-gc-telemetry.
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

let mockConfig: Record<string, unknown>;
let healthFixture: Record<string, unknown> | null;
let putBodies: any[] = [];

function mockFetchConfig() {
  return vi.fn().mockImplementation((url: string, options?: any) => {
    if (url === "/api/health") {
      return healthFixture
        ? Promise.resolve({ ok: true, json: () => Promise.resolve(healthFixture) })
        : Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    }
    if (url === "/api/config" && !options?.method) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: mockConfig }) });
    }
    if (url === "/api/config" && options?.method === "PUT") {
      putBodies.push(JSON.parse(options.body));
      return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  });
}

function gotoPage(name: string) {
  fireEvent.click(within(screen.getByTestId("settings-nav-rail")).getByRole("button", { name }));
}

async function renderPanel(page: "Sessions" | "Server") {
  render(<SettingsPanel />);
  await waitFor(() => screen.getByText("Interface"));
  gotoPage(page);
  await waitFor(() => screen.getByTestId(page === "Sessions" ? "session-heap-max-old-space" : "server-heap-max-old-space"));
}

const sessionInput = () => screen.getByTestId("session-heap-max-old-space") as HTMLInputElement;
const serverInput = () => screen.getByTestId("server-heap-max-old-space") as HTMLInputElement;

beforeEach(() => {
  vi.restoreAllMocks();
  putBodies = [];
  healthFixture = null;
  mockConfig = {
    port: 8000,
    piPort: 9999,
    autoStart: true,
    autoShutdown: true,
    shutdownIdleSeconds: 300,
    spawnStrategy: "headless",
    tunnel: { enabled: true },
    devBuildOnReload: false,
    memoryLimits: { maxEventsPerSession: 200, maxStringFieldSize: 4000, maxWsBufferBytes: 4194304 },
    sessionHeap: { maxOldSpaceMb: 512 },
    serverHeap: { maxOldSpaceMb: 1536 },
    maxConcurrentSubagents: 2,
  };
  fetchAutoInitWorktreePref.mockResolvedValue(false);
  setAutoInitWorktreePref.mockResolvedValue(true);
  window.history.replaceState({}, "", "/settings/general");
  global.fetch = mockFetchConfig();
});
afterEach(() => cleanup());

describe("page attribution (test-plan #E19)", () => {
  it("a sessionHeap edit is attributed to Sessions and not Server", async () => {
    await renderPanel("Sessions");
    fireEvent.change(sessionInput(), { target: { value: "1024" } });

    const saveBar = await waitFor(() => screen.getByTestId("settings-save-bar"));
    expect(within(saveBar).getByRole("button", { name: "Sessions" })).toBeTruthy();
    expect(within(saveBar).queryByRole("button", { name: "Server" })).toBeNull();
  });

  it("a serverHeap edit is attributed to Server and not Sessions", async () => {
    await renderPanel("Server");
    fireEvent.change(serverInput(), { target: { value: "2048" } });

    const saveBar = await waitFor(() => screen.getByTestId("settings-save-bar"));
    expect(within(saveBar).getByRole("button", { name: "Server" })).toBeTruthy();
    expect(within(saveBar).queryByRole("button", { name: "Sessions" })).toBeNull();
  });
});

describe("save payload (test-plan #E20)", () => {
  it("includes the changed top-level heap key rather than dropping it", async () => {
    await renderPanel("Sessions");
    fireEvent.change(sessionInput(), { target: { value: "1024" } });

    const btn = await waitFor(() => screen.getByTestId("save-btn"));
    fireEvent.click(btn);
    await waitFor(() => expect(putBodies.length).toBeGreaterThan(0));
    expect(putBodies[0].sessionHeap).toEqual({ maxOldSpaceMb: 1024 });
  });

  it("writes only the changed field, so a sibling is not pinned", async () => {
    mockConfig.sessionHeap = { maxOldSpaceMb: 512, initialOldSpaceMb: 64 };
    await renderPanel("Sessions");
    fireEvent.change(sessionInput(), { target: { value: "256" } });

    const btn = await waitFor(() => screen.getByTestId("save-btn"));
    fireEvent.click(btn);
    await waitFor(() => expect(putBodies.length).toBeGreaterThan(0));
    expect(putBodies[0].sessionHeap).toEqual({ maxOldSpaceMb: 256 });
  });
});

describe("entry validation (test-plan #E21)", () => {
  it("refuses 63 and explains the floor", async () => {
    await renderPanel("Sessions");
    fireEvent.change(sessionInput(), { target: { value: "63" } });

    expect(screen.getByTestId("session-heap-max-old-space-error").textContent).toMatch(/at least 64 MB/i);
    // A refused value never reaches the draft, so Save is not an escape route.
    expect((screen.queryByTestId("save-btn") as HTMLButtonElement | null)?.disabled ?? true).toBe(true);
  });

  it.each(["64", "8192"])("accepts %s silently", async (value) => {
    await renderPanel("Sessions");
    fireEvent.change(sessionInput(), { target: { value } });

    expect(screen.queryByTestId("session-heap-max-old-space-error")).toBeNull();
    expect(screen.queryByTestId("session-heap-max-old-space-warn")).toBeNull();
    const btn = await waitFor(() => screen.getByTestId("save-btn"));
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("accepts 8193 WITH a warning — warned, never blocked", async () => {
    await renderPanel("Sessions");
    fireEvent.change(sessionInput(), { target: { value: "8193" } });

    expect(screen.getByTestId("session-heap-max-old-space-warn")).toBeTruthy();
    expect(screen.queryByTestId("session-heap-max-old-space-error")).toBeNull();
    const btn = await waitFor(() => screen.getByTestId("save-btn"));
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("the refusal is not sticky — a corrected value clears it", async () => {
    await renderPanel("Sessions");
    fireEvent.change(sessionInput(), { target: { value: "16" } });
    expect(screen.getByTestId("session-heap-max-old-space-error")).toBeTruthy();
    fireEvent.change(sessionInput(), { target: { value: "1024" } });
    expect(screen.queryByTestId("session-heap-max-old-space-error")).toBeNull();
  });
});

describe("effect-boundary copy (test-plan #F1, #E31)", () => {
  it("the session fields say they apply to newly started sessions", async () => {
    await renderPanel("Sessions");
    expect(screen.getByTestId("session-heap-effect-boundary").textContent).toMatch(
      /newly started sessions/i,
    );
  });

  it("the server field states a COLD start and denies the in-place restart", async () => {
    await renderPanel("Server");
    const copy = screen.getByTestId("server-heap-effect-boundary").textContent ?? "";
    expect(copy).toMatch(/cold start/i);
    // The generic banner promises an in-place restart suffices; for this field
    // it provably does not, so the copy must say so explicitly.
    expect(copy).toMatch(/will NOT apply/i);
  });
});

describe("configured-vs-effective divergence (test-plan #E32)", () => {
  it("surfaces that the running process differs from the configured value", async () => {
    healthFixture = { server: { effectiveMaxOldSpaceMb: 8192 } };
    await renderPanel("Server");
    const note = await waitFor(() => screen.getByTestId("server-heap-divergence"));
    expect(note.textContent).toMatch(/8192/);
  });

  it("stays silent when the running process already matches", async () => {
    healthFixture = { server: { effectiveMaxOldSpaceMb: 1536 } };
    await renderPanel("Server");
    await waitFor(() => screen.getByTestId("server-heap-max-old-space"));
    expect(screen.queryByTestId("server-heap-divergence")).toBeNull();
  });
});

describe("subagent coupling warning (test-plan #E24)", () => {
  it("is silent at the shipped 512 / 2 pairing", async () => {
    await renderPanel("Sessions");
    expect(screen.queryByTestId("session-heap-subagent-warning")).toBeNull();
  });

  it("warns and names the per-child figure once the pairing gets thin", async () => {
    await renderPanel("Sessions");
    const subagents = screen.getByRole("spinbutton", { name: /Max concurrent subagents/i });
    fireEvent.change(subagents, { target: { value: "8" } });

    const warning = await waitFor(() => screen.getByTestId("session-heap-subagent-warning"));
    expect(warning.textContent).toMatch(/56 MB/);
    // Non-blocking: both values are still valid and still saveable.
    const btn = await waitFor(() => screen.getByTestId("save-btn"));
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });
});
