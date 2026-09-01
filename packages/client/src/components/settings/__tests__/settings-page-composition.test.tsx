import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

// Plugin-page seam for the dirty-plugin-page rail gate (#E8a/#E9): a real
// plugin body needs the plugin runtime's slot machinery, but the gate only
// needs a registered DIRTY draft source filed under the plugin's page plus a
// caller that drives `requestRailNavigate` WITH a scroll target. The stub
// registers exactly that and exposes the trigger button.
vi.mock("../PluginSettingsPage.js", async () => {
  const { createElement } = await import("react");
  const { useSettingsDraftSource } = await import("@blackbelt-technology/dashboard-plugin-runtime");
  return {
    PluginNotFoundNotice: ({ pluginId }: { pluginId: string }) =>
      createElement("div", { "data-testid": "plugin-not-found-notice" }, pluginId),
    PluginSettingsPage: ({ onNavigate }: { onNavigate: (to: string, scrollTarget?: string) => void }) => {
      useSettingsDraftSource({
        id: "test-plugin-draft",
        page: "plugins/test-plugin",
        isDirty: true,
        commit: async () => {},
        reset: () => {},
      });
      return createElement(
        "button",
        {
          "data-testid": "plugin-nav-with-target",
          onClick: () => onNavigate("/settings/developer", "pi-runtime-section"),
        },
        "navigate with target",
      );
    },
  };
});

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
    // Fixtures for the pi runtime row tests — unset keeps the legacy
    // everything-else-404 behaviour so pre-existing cases are untouched.
    if (healthFixture && url === "/api/health") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(healthFixture) });
    }
    if (pluginsFixture && url === "/api/plugins") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, plugins: pluginsFixture }) });
    }
    if (url === "/api/config" && !options?.method) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: mockConfig }) });
    }
    if (url === "/api/config" && options?.method === "PUT") {
      return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  });
}

// Mutable per-test fixtures. `healthFixture` null = /api/health falls through
// to the 404 branch (compatibility + piRuntime both null → advisory hidden,
// row hidden — the pre-change rendering).
let healthFixture: Record<string, unknown> | null = null;
let pluginsFixture: Array<Record<string, unknown>> | null = null;

const HEALTHY_COMPATIBILITY = {
  minimum: "0.78.0",
  recommended: "0.80.0",
  maximum: null,
  current: "0.80.0",
};

function healthPayload(piRuntime: Record<string, unknown> | null) {
  return { compatibility: HEALTHY_COMPATIBILITY, piRuntime };
}

function piRuntimeFixture(over: Record<string, unknown> = {}) {
  return { spawnVersion: "0.84.1", moduleVersion: "0.84.1", consumerDiverged: false, consumerMessage: null, ...over };
}

const TEST_PLUGIN_ROW = {
  id: "test-plugin",
  displayName: "Test Plugin",
  priority: 0,
  hasServer: false,
  hasBridge: false,
  hasClient: true,
  claims: [{ slot: "settings-section" }],
  status: { id: "test-plugin", displayName: "Test Plugin", enabled: true, loaded: true, claims: 1 },
};

/** Record every fetch URL so the single-poller assertion can count exactly. */
function spyOnFetchCalls(): Array<{ url: string; method?: string }> {
  const inner = global.fetch as unknown as (url: string, options?: any) => Promise<unknown>;
  const calls: Array<{ url: string; method?: string }> = [];
  (global as { fetch: unknown }).fetch = vi.fn().mockImplementation((url: string, options?: any) => {
    calls.push({ url, method: options?.method });
    return inner(url, options);
  });
  (global as { __fetchCalls?: Array<{ url: string; method?: string }> }).__fetchCalls = calls;
  return calls;
}

const healthCalls = (calls: Array<{ url: string }>) => calls.filter((c) => c.url === "/api/health");

/** jsdom has no real layout: stub scrollIntoView, restore after the test. */
function stubScrollIntoView() {
  const fn = vi.fn();
  const proto = Element.prototype as unknown as Record<string, unknown>;
  const prev = proto.scrollIntoView;
  proto.scrollIntoView = fn;
  return {
    fn,
    restore: () => {
      if (prev === undefined) delete proto.scrollIntoView;
      else proto.scrollIntoView = prev;
    },
  };
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

  /**
   * The naming model is the `naming` ROLE, so it is configured in the Roles
   * panel — one source of truth, no second preference. Without a pointer the
   * operator has no way to discover that from the toggle, and an unassigned
   * `naming` reads as "auto-naming is broken" rather than "@fast is used".
   * See change: fix-auto-naming-reasoning-model (test-plan #F5).
   */
  it("F5: the auto-name toggle points at the @naming role and its @fast fallback", async () => {
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));
    gotoPage("Sessions");
    await waitFor(() => screen.getByText(/Session Strategy/i));

    const pointer = screen.getByTestId("auto-name-model-pointer");
    expect(pointer.textContent).toMatch(/@naming/);
    expect(pointer.textContent).toMatch(/Roles/);
    expect(pointer.textContent).toMatch(/@fast/);
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

  // Regression: the chat-display draft used to be re-seeded from the baseline
  // on the section's MOUNT pass, so a toggle flipped between the commit that
  // painted it and the passive-effect flush was silently reverted (the dirty
  // flag is written during render, so the effect still read "clean"). Under
  // load this surfaced as a flaky "Token stats bar did not flip" in CI, and
  // for a real user as a fast first click on Settings doing nothing.
  //
  // The interleaving is pinned by clicking from a MutationObserver callback --
  // the same microtask checkpoint `waitFor` wakes on -- which runs right after
  // the commit that paints the toggle and before the scheduler's macrotask that
  // flushes the new passive effects.
  it("keeps a toggle flipped before the mount effects flush", async () => {
    let releaseConfig: () => void = () => {};
    const gate = new Promise<void>((resolve) => { releaseConfig = resolve; });
    const inner = mockFetchConfig();
    global.fetch = vi.fn().mockImplementation(async (url: string, options?: any) => {
      if (url === "/api/config" && !options?.method) await gate;
      return inner(url, options);
    });

    render(<SettingsPanel />);
    expect(screen.queryByText("Interface")).toBeNull();

    const clickedOnPaint = new Promise<{ before: string | null; after: string | null }>((resolve) => {
      const observer = new MutationObserver(() => {
        const toggle = screen.queryByRole("switch", { name: "Token stats bar" });
        if (!toggle) return;
        observer.disconnect();
        const before = toggle.getAttribute("aria-checked");
        fireEvent.click(toggle);
        resolve({ before, after: toggle.getAttribute("aria-checked") });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });

    releaseConfig();
    const { before, after } = await clickedOnPaint;

    expect(before).toBe("true");
    expect(after, "click did not flip the toggle").toBe("false");
    // Survives the passive-effect flush that `fireEvent`'s act() ran on exit.
    expect(screen.getByRole("switch", { name: "Token stats bar" }).getAttribute("aria-checked")).toBe("false");
    expect(await waitFor(() => screen.getByTestId("settings-save-bar"))).toBeTruthy();
  });

  // ── pi runtime status row — surface-pi-runtime-on-general ────────────────

  // #E1 — the row is permanent: healthy fixture (advisory's visibility
  // condition false) still renders it, with both consumers + shared version.
  it("renders the runtime row on General although the advisory renders nothing (#E1)", async () => {
    healthFixture = healthPayload(piRuntimeFixture());
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));

    const row = screen.getByTestId("pi-runtime-status-row");
    expect(within(row).getByText("Sessions spawn")).toBeTruthy();
    expect(within(row).getByText("Server imports")).toBeTruthy();
    expect(within(row).getAllByText("0.84.1")).toHaveLength(2);
    // The healthy fixture keeps the advisory hidden — the row is NOT gated on
    // the advisory's visibility condition.
    expect(screen.queryByText(/installed;/)).toBeNull();
  });

  // #E6 — state convergence: ONE polling instance feeds both surfaces. The
  // panel tree also mounts pre-existing ONE-SHOT /api/health readers
  // (staleness banner, plugin-enabled-set, launch-source), so the mount count
  // is ≥1 — what pins the single-poller invariant is the DELTA: exactly +1
  // across the 90s window (one 60s tick of the panel-owned poller). A second
  // live poller — e.g. a row-mounted hook — would make the delta ≥2. The row
  // issuing zero fetches is asserted directly in its own suite (#E5).
  it("has exactly one health poller: +1 fetch across 90s (#E6)", async () => {
    healthFixture = healthPayload(piRuntimeFixture());
    pluginsFixture = null;
    vi.useFakeTimers();
    try {
      const calls = spyOnFetchCalls();
      render(<SettingsPanel />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByTestId("pi-runtime-status-row")).toBeTruthy();
      const atMount = healthCalls(calls).length;
      expect(atMount).toBeGreaterThanOrEqual(1);

      await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
      expect(healthCalls(calls).length).toBe(atMount + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  // #E12 — the row is a status surface, not a field: no CONFIG_FIELD_PAGE
  // entry, no Save Bar contribution. Clean panel + row → no Save Bar at all.
  it("the row contributes no dirty state — no Save Bar on a clean panel (#E12)", async () => {
    healthFixture = healthPayload(piRuntimeFixture());
    pluginsFixture = null;
    render(<SettingsPanel />);
    await waitFor(() => screen.getByTestId("pi-runtime-status-row"));
    expect(screen.queryByTestId("settings-save-bar")).toBeNull();
  });

  // #E8(b) — built-in draft dirty on General must NOT block the rail helper:
  // the gate exists for plugin-page edits only. Navigates immediately, no
  // prompt, and the scroll target is consumed after the destination renders.
  it("built-in draft dirty on General: Change… navigates immediately, no prompt, scrolls (#E8b)", async () => {
    healthFixture = healthPayload(piRuntimeFixture());
    pluginsFixture = null;
    const scroll = stubScrollIntoView();
    render(<SettingsPanel />);
    try {
      await waitFor(() => screen.getByText("Interface"));
      // Make the panel dirty through a real General field.
      const label = screen.getByText("PWA Display Name");
      const input = label.closest("div")!.querySelector("input")!;
      fireEvent.change(input, { target: { value: "laptop" } });
      await waitFor(() => screen.getByTestId("settings-save-bar"));

      fireEvent.click(screen.getByTestId("pi-runtime-status-change"));

      expect(screen.queryByTestId("unsaved-changes-dialog")).toBeNull();
      expect(window.location.pathname).toBe("/settings/developer");
      await waitFor(() => expect(scroll.fn).toHaveBeenCalled());
    } finally {
      scroll.restore();
    }
  });

  // #E8(a) + #E9 — from a DIRTY PLUGIN page the same request takes the same
  // confirmation round trip the Save Bar chips take, and the scroll target
  // survives the deferral: consumed when the confirmed navigation renders the
  // destination. No new or strengthened gate.
  it("dirty plugin page + scroll target: confirm round trip, target survives deferral (#E8a/#E9)", async () => {
    healthFixture = healthPayload(piRuntimeFixture());
    pluginsFixture = [TEST_PLUGIN_ROW];
    setPath("/settings/plugins/test-plugin");
    const scroll = stubScrollIntoView();
    render(<SettingsPanel />);
    try {
      const trigger = await waitFor(() => screen.getByTestId("plugin-nav-with-target"));
      // The stub's dirty draft source must be registered before the click —
      // the Save Bar appearing proves the registry knows about it.
      await waitFor(() => screen.getByTestId("settings-save-bar"));

      fireEvent.click(trigger);
      // (a) same gate as the chips: the confirmation round trip, not a
      // silent navigate, and not a scroll either.
      await waitFor(() => screen.getByTestId("unsaved-changes-dialog"));
      expect(scroll.fn).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId("unsaved-discard"));
      // (e9) deferred navigation completes AND consumes the pending
      // scroll-target ref — the section scrolls in after the destination
      // renders; the route stays plain /settings/<page>.
      await waitFor(() => expect(screen.queryByTestId("unsaved-changes-dialog")).toBeNull());
      expect(window.location.pathname).toBe("/settings/developer");
      expect(window.location.search).toBe("");
      await waitFor(() => expect(scroll.fn).toHaveBeenCalled());
    } finally {
      scroll.restore();
      pluginsFixture = null;
    }
  });
});
