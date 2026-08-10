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

  // test-plan #F1
  it("renders the default-model control before every other Sessions control", async () => {
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));
    gotoPage("Sessions");
    await waitFor(() => screen.getByText(/Session Strategy/i));

    const content = screen.getByTestId("settings-content");
    const controls = content.querySelectorAll("input, select, button");
    expect(controls.length).toBeGreaterThan(1);

    const calloutLabel = screen.getByText(/Default model/i);
    const callout = calloutLabel.closest("div")!.parentElement!;
    // The very first control on the page must live inside the callout.
    expect(callout.contains(controls[0])).toBe(true);
  });

  // test-plan #F2
  it("states the brand-new-only caveat on the default-model callout", async () => {
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));
    gotoPage("Sessions");
    await waitFor(() => screen.getByText(/Session Strategy/i));

    expect(screen.getByText(/brand-new sessions/i)).toBeTruthy();
    expect(screen.getByText(/resumed session keeps the model/i)).toBeTruthy();
  });

  // test-plan #F3
  it("styles the default-model callout with severity-info tokens", async () => {
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));
    gotoPage("Sessions");
    await waitFor(() => screen.getByText(/Session Strategy/i));

    const calloutLabel = screen.getByText(/Default model/i);
    const callout = calloutLabel.closest("div")!.parentElement!;
    expect(callout.className).toMatch(/--severity-info-/);
  });

  // test-plan #F4
  it("groups the Sessions page into the four concern sections, in order", async () => {
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));
    gotoPage("Sessions");
    await waitFor(() => screen.getByText(/Session Strategy/i));

    const content = screen.getByTestId("settings-content");
    const text = content.textContent ?? "";
    const order = ["New session defaults", "Session list", "Lifecycle & recovery", "Worktrees", "Retry"];
    const positions = order.map((title) => text.indexOf(title));

    positions.forEach((pos, i) => expect(pos, `"${order[i]}" section missing`).toBeGreaterThan(-1));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i], `${order[i]} must follow ${order[i - 1]}`).toBeGreaterThan(positions[i - 1]);
    }
  });

  // test-plan #F7
  it("nests the idle-shutdown delay beneath the toggle that gates it", async () => {
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));
    gotoPage("Server");
    await waitFor(() => screen.getByText("Memory Limits"));

    const gate = screen.getByText("Auto Shutdown");
    const dependent = screen.getByText(/Idle before shutdown/i);
    const group = dependent.closest('[data-testid="gated-group"]');

    expect(group, "dependent is not inside a gated group").not.toBeNull();
    // the gating toggle itself must sit OUTSIDE the indented group
    expect(group!.contains(gate)).toBe(false);
  });

  // test-plan #F8
  it("nests the reasoning dependents beneath the reasoning toggle", async () => {
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));

    const gate = screen.getByText("Reasoning blocks");
    const autoCollapse = screen.getByText(/Reasoning auto-collapse/i);
    const keepOpen = screen.getByText(/Keep reasoning open until turn ends/i);

    const group = autoCollapse.closest('[data-testid="gated-group"]');
    expect(group).not.toBeNull();
    expect(group!.contains(keepOpen)).toBe(true);
    expect(group!.contains(gate)).toBe(false);
  });

  // test-plan #F9
  it("nests the OpenSpec polling knobs beneath the enable toggle", async () => {
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));
    gotoPage("OpenSpec");
    await waitFor(() => screen.getByText("Enable OpenSpec"));

    const gate = screen.getByText("Enable OpenSpec");
    const group = screen.getByText(/Poll interval/i).closest('[data-testid="gated-group"]');

    expect(group).not.toBeNull();
    // Scoped to the group: the section intro prose also mentions "change
    // detection", so a page-wide query is ambiguous.
    for (const knob of ["Poll interval", "Max concurrent +Sessions", "Change Detection", "Jitter"]) {
      expect(within(group as HTMLElement).getByText(knob), `${knob} not nested`).toBeTruthy();
    }
    expect(group!.contains(gate)).toBe(false);
  });

  // test-plan #F13 — D8: three visual sub-sections, one draft source.
  it("shows a single General chip however many chat-display sub-sections are edited", async () => {
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));

    // one control from each of the three sub-sections
    for (const label of ["Token stats bar", "Reasoning blocks", "Tool result bodies"]) {
      // Address the switch by its accessible name rather than walking up to the
      // nearest <div> and taking that subtree's first <button>: the old
      // selector silently clicks a neighbouring control whenever the field
      // markup regroups, and a click on the wrong control still "succeeds".
      const toggle = screen.getByRole("switch", { name: label });
      const before = toggle.getAttribute("aria-checked");
      fireEvent.click(toggle);
      // Pin the click itself. Without this the two failure modes -- the click
      // never landed, vs. it landed but the dirty state never reached the save
      // bar -- are indistinguishable, and both surface as the same misleading
      // "unable to find settings-save-bar".
      expect(toggle.getAttribute("aria-checked"), `${label} did not flip`).not.toBe(before);
      const saveBar = await waitFor(() => screen.getByTestId("settings-save-bar"));
      expect(within(saveBar).getAllByRole("button", { name: "General" })).toHaveLength(1);
    }
  });

  // test-plan #F6 — D2 dropped the Gateway move; this guards the reversal.
  it("keeps the tunnel watchdog fields on Server", async () => {
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));

    gotoPage("Server");
    await waitFor(() => screen.getByText("Memory Limits"));
    expect(screen.getByText(/Enable Watchdog/i)).toBeTruthy();

    // F6 has two halves: present on Server AND absent from Gateway. Asserting
    // only the first would still pass if the fields were duplicated onto
    // Gateway, which is precisely the move D2 rejected.
    gotoPage("Gateway");
    await waitFor(() => screen.getByTestId("settings-content"));
    expect(screen.queryByText(/Enable Watchdog/i)).toBeNull();
    expect(screen.queryByText(/Probe interval/i)).toBeNull();
    expect(screen.queryByText(/Failure Threshold/i)).toBeNull();
  });
});
