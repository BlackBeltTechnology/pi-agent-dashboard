import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AllowedHostsSection } from "../AllowedHostsSection.js";
import { SettingsPanel } from "../SettingsPanel.js";

// Allowed hostnames section on Settings ▸ Security — the operator surface of
// the DNS-rebinding Host gate. Unit rows mount the section directly; the
// integration rows mount the full panel (harness glue copied from
// ../../__tests__/SettingsPanel.test.tsx).
// See change: add-host-allowlist-admission.

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

const GATE_DEFAULT = {
  success: true,
  mode: "report",
  envOverridden: false,
  admitted: [],
  recent: [],
};

/** Mutable per-test fixture for `GET /api/host-gate`. */
let gateFixture: Record<string, unknown> = { ...GATE_DEFAULT };
let gateStatus = 200;

const panelConfig = {
  port: 8000,
  piPort: 9999,
  autoStart: true,
  autoShutdown: true,
  shutdownIdleSeconds: 300,
  spawnStrategy: "headless",
  tunnel: { enabled: true },
  devBuildOnReload: false,
  memoryLimits: { maxEventsPerSession: 200, maxStringFieldSize: 4000, maxWsBufferBytes: 4194304 },
  hostGate: { mode: "report" },
  allowedHosts: [] as string[],
};

/** Panel harness: /api/config + /api/host-gate, everything else 404s. */
function mockPanelFetch(overrides?: Record<string, unknown>) {
  const cfg = { ...panelConfig, ...overrides };
  const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
  const fn = vi.fn().mockImplementation((url: string, options?: any) => {
    calls.push({
      url,
      method: options?.method,
      body: options?.body ? JSON.parse(options.body) : undefined,
    });
    if (url === "/api/host-gate") {
      return Promise.resolve({
        ok: gateStatus < 400,
        status: gateStatus,
        json: () => Promise.resolve(gateFixture),
      });
    }
    if (url === "/api/config" && !options?.method) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: cfg }) });
    }
    if (url === "/api/config" && options?.method === "PUT") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  });
  (globalThis as unknown as { __panelFetchCalls: typeof calls }).__panelFetchCalls = calls;
  return fn;
}

function panelPutCalls() {
  const calls = (globalThis as unknown as { __panelFetchCalls?: Array<{ url: string; method?: string; body?: unknown }> }).__panelFetchCalls ?? [];
  return calls.filter((c) => c.method === "PUT" && c.url === "/api/config");
}

function setPath(path: string) {
  window.history.replaceState({}, "", path);
}

async function renderSecurityPanel(overrides?: Record<string, unknown>) {
  global.fetch = mockPanelFetch(overrides);
  setPath("/settings/security");
  render(<SettingsPanel />);
  await waitFor(() => screen.getByText("Allowed hostnames"));
}

describe("AllowedHostsSection — unit (direct mount)", () => {
  interface SectionState {
    mode: "report" | "enforce";
    hosts: string[];
  }

  // Stateful harness: the section's value props are CONTROLLED by the draft,
  // so a change must flow through a real state update or React resets the
  // DOM value on the next render — exactly what the panel does for it.
  function renderSection(
    gate: Record<string, unknown>,
    initial: SectionState = { mode: "report", hosts: [] },
    opts?: { status?: number },
  ) {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/host-gate") {
        return Promise.resolve({ ok: (opts?.status ?? 200) < 400, status: opts?.status ?? 200, json: () => Promise.resolve(gate) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });
    const captured: SectionState = { ...initial };
    function Harness() {
      const [state, setState] = useState<SectionState>({ ...initial });
      captured.mode = state.mode;
      captured.hosts = state.hosts;
      return (
        <AllowedHostsSection
          mode={state.mode}
          allowedHosts={state.hosts}
          onModeChange={(mode) => setState((s) => ({ ...s, mode }))}
          onAllowedHostsChange={(hosts) => setState((s) => ({ ...s, hosts }))}
          onNavigate={() => {}}
        />
      );
    }
    const view = render(<Harness />);
    return { view, state: captured };
  }

  /** Wait until the gate fetch has landed (the recent list only renders then). */
  async function untilGateLoaded(hasRecent: boolean) {
    await waitFor(() =>
      expect(hasRecent ? screen.getByTestId("host-gate-recent") : screen.getByTestId("host-gate-recent-empty")).toBeTruthy(),
    );
  }

  function extra() {
    return screen.getByTestId("host-gate-extra") as HTMLTextAreaElement;
  }

  afterEach(() => cleanup());

  // test-plan #E26 — a scheme/port/path entry is explained with the bare name.
  it("marks a scheme/port/path entry invalid and states the bare hostname", async () => {
    const { state } = renderSection({ ...GATE_DEFAULT });
    await untilGateLoaded(false);
    fireEvent.change(extra(), { target: { value: "https://dash.home.arpa:9443/" } });
    fireEvent.blur(extra());
    expect(extra().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByTestId("host-gate-extra-error").textContent).toContain("dash.home.arpa");
    // The invalid entry is not silently dropped from the draft either.
    expect(state.hosts).toEqual(["https://dash.home.arpa:9443/"]);
  });

  // test-plan #E26 — a name the gate could never admit is refused at entry.
  it("refuses a name the gate cannot admit", async () => {
    renderSection({ ...GATE_DEFAULT });
    await untilGateLoaded(false);
    fireEvent.change(extra(), { target: { value: "my_service.docker" } });
    fireEvent.blur(extra());
    expect(extra().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByTestId("host-gate-extra-error").textContent).toMatch(/cannot be used/);
  });

  // test-plan #E26 — a valid bare hostname reaches the draft, no error.
  it("accepts a bare hostname into the draft", async () => {
    const { state } = renderSection({ ...GATE_DEFAULT });
    await untilGateLoaded(false);
    fireEvent.change(extra(), { target: { value: "dash.home.arpa" } });
    fireEvent.blur(extra());
    expect(extra().getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByTestId("host-gate-extra-error")).toBeNull();
    expect(state.hosts).toEqual(["dash.home.arpa"]);
  });

  // test-plan #F7 — the outcome pill reads each entry's own outcome.
  it("renders the outcome pill per entry, not from the mode control", async () => {
    renderSection(
      {
        ...GATE_DEFAULT,
        recent: [
          { host: "a.example", count: 1, lastSeen: 1, outcome: "would-refuse" },
          { host: "b.example", count: 2, lastSeen: 2, outcome: "refused" },
        ],
      },
      { mode: "enforce", hosts: [] },
    );
    await untilGateLoaded(true);
    const rows = screen.getAllByTestId("host-gate-recent-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("would-refuse")).toBeTruthy();
    expect(within(rows[1]).getByText("refused")).toBeTruthy();
  });

  // test-plan #F5 (draft half) — Allow appends to the draft, never writes.
  it("Allow moves a refusal into the draft allow-list without a write", async () => {
    const { state } = renderSection({
      ...GATE_DEFAULT,
      recent: [{ host: "proxy-int.corp", count: 1, lastSeen: 1, outcome: "would-refuse" }],
    });
    await untilGateLoaded(true);
    const fetchSpy = global.fetch as ReturnType<typeof vi.fn>;
    fireEvent.click(screen.getByRole("button", { name: "Allow proxy-int.corp" }));
    expect(extra().value).toContain("proxy-int.corp");
    expect(state.hosts).toEqual(["proxy-int.corp"]);
    expect(screen.queryByRole("button", { name: "Allow proxy-int.corp" })).toBeNull();
    const puts = fetchSpy.mock.calls.filter((call) => (call[1] as any)?.method === "PUT");
    expect(puts).toHaveLength(0);
  });

  // test-plan #X6 — endpoint failure degrades, never crashes.
  it("keeps mode control and textarea editable when the endpoint fails", async () => {
    renderSection({ success: false }, { mode: "report", hosts: [] }, { status: 500 });
    await waitFor(() => screen.getAllByText(/Failed to load \/api\/host-gate/));
    expect(screen.getAllByText(/Failed to load \/api\/host-gate/).length).toBeGreaterThanOrEqual(2);
    for (const name of ["Report only", "Enforce"]) {
      expect((screen.getByRole("radio", { name }) as HTMLButtonElement).disabled).toBe(false);
    }
    fireEvent.change(extra(), { target: { value: "dash.home.arpa" } });
    expect(extra().value).toBe("dash.home.arpa");
  });

  // test-plan #F10 (unit half) — every control resolves an accessible name,
  // and no state is colour-only (pills carry their text).
  it("gives every control an accessible name", async () => {
    renderSection({
      ...GATE_DEFAULT,
      recent: [{ host: "rebind.example", count: 3, lastSeen: 1, outcome: "would-refuse" }],
    });
    await untilGateLoaded(true);
    expect(screen.getByRole("radiogroup", { name: /host gate mode/i })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Report only" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Enforce" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /Additional hostnames/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Allow rebind.example" })).toBeTruthy();
    expect(screen.getByText("would-refuse")).toBeTruthy();
  });
});

describe("AllowedHostsSection — Security page integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchAutoInitWorktreePref.mockResolvedValue(false);
    setAutoInitWorktreePref.mockResolvedValue(true);
    gateFixture = { ...GATE_DEFAULT };
    gateStatus = 200;
    setPath("/settings/security");
  });

  afterEach(() => cleanup());

  // test-plan #F1 — composition: heading between Trusted Networks and Pair a
  // device, radios, empty refusals copy.
  it("renders the section between Trusted Networks and Pair a device", async () => {
    await renderSecurityPanel();
    await waitFor(() => screen.getByText("Trusted Networks"));

    const content = screen.getByTestId("settings-content");
    const text = content.textContent ?? "";
    const positions = ["Trusted Networks", "Allowed hostnames", "Pair a device"].map((s) => text.indexOf(s));
    positions.forEach((pos, i) => expect(pos, `"${["Trusted Networks", "Allowed hostnames", "Pair a device"][i]}" missing`).toBeGreaterThan(-1));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i], "Allowed hostnames must sit between its neighbours").toBeGreaterThan(positions[i - 1]);
    }
    expect(screen.getByRole("radio", { name: "Report only", checked: true })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Enforce", checked: false })).toBeTruthy();
    // Empty-state copy renders once the gate fetch lands (recent: []).
    await waitFor(() => screen.getByText("No refusals since start."));
  });

  // test-plan #F2 — mode consequence inline, no confirm dialog, no fetch.
  it("states the Enforce consequence inline without confirm or fetch", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    global.fetch = mockPanelFetch();
    setPath("/settings/security");
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Allowed hostnames"));
    const fetchSpy = global.fetch as ReturnType<typeof vi.fn>;
    const callsBefore = fetchSpy.mock.calls.length;

    fireEvent.click(screen.getByRole("radio", { name: "Enforce" }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Enforce", checked: true })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("settings-save-bar")).toBeTruthy());
    expect(screen.getByText(/403/)).toBeTruthy();
    // Switching mode is a draft edit only — no WRITE left the panel. Low
    // total-call counts are NOT asserted: the section polls `GET /api/host-gate`
    // on a timer, and a poll (or a late mount fetch) can land between the click
    // and this assertion.
    expect(
      fetchSpy.mock.calls
        .slice(callsBefore)
        .filter((call) => {
          const method = (call[1] as any)?.method;
          return method !== undefined && method !== "GET" && method !== "HEAD";
        }),
    ).toHaveLength(0);
  });

  // test-plan #F3 — env override disables both options and names the variable.
  it("disables the mode control with the PI_DASHBOARD_HOST_GATE reason", async () => {
    gateFixture = { ...GATE_DEFAULT, envOverridden: true, mode: "report" };
    await renderSecurityPanel();
    await waitFor(() =>
      expect((screen.getByRole("radio", { name: "Report only" }) as HTMLButtonElement).disabled).toBe(true),
    );
    expect((screen.getByRole("radio", { name: "Enforce" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/PI_DASHBOARD_HOST_GATE/)).toBeTruthy();
  });

  // test-plan #F4 — admitted rows render from the endpoint, derived rows link
  // to their source, pattern rows do not, and nothing offers a remove.
  it("renders admitted rows from GET /api/host-gate with source pills and links", async () => {
    gateFixture = {
      ...GATE_DEFAULT,
      admitted: [
        { host: "pi.example.com", source: "public-base-url" },
        { host: "*.local", source: "local" },
        { host: "any IP address", source: "ip-address" },
      ],
    };
    await renderSecurityPanel();
    await waitFor(() => expect(screen.getByText("pi.example.com")).toBeTruthy());

    const row = screen.getByText("pi.example.com").closest("li");
    expect(row).toBeTruthy();
    expect(within(row!).getByText("public base URL")).toBeTruthy();
    expect(within(row!).queryByRole("button", { name: /remove/i })).toBeNull();

    // Pattern rows carry a pill but no link.
    const localRow = screen.getByText("*.local").closest("li");
    expect(within(localRow!).getByText(".local")).toBeTruthy();
    expect(within(localRow!).queryByRole("button", { name: /Gateway|Server/ })).toBeNull();
    const ipRow = screen.getByText("any IP address").closest("li");
    expect(within(ipRow!).getByText("IP address")).toBeTruthy();
    expect(within(ipRow!).queryByRole("button", { name: /Gateway|Server/ })).toBeNull();

    // Derived row: link to the Gateway page — navigation asserted last, since
    // the click unmounts the Security page.
    const link = within(row!).getByRole("button", { name: /Gateway/ });
    fireEvent.click(link);
    expect(window.location.pathname).toBe("/settings/gateway");

    // The client never re-derives admission (design D8): the section must not
    // import the server-side derive helper.
    const src = readFileSync(`${import.meta.dirname}/../AllowedHostsSection.tsx`, "utf8");
    expect(src).not.toMatch(/isHostAdmitted/);
  });

  // test-plan #F5 (Save half) — the panel Save persists the appended host.
  it("persists an Allowed refusal through the panel Save", async () => {
    gateFixture = {
      ...GATE_DEFAULT,
      recent: [{ host: "proxy-int.corp", count: 1, lastSeen: 1, outcome: "would-refuse" }],
    };
    await renderSecurityPanel();
    await waitFor(() => screen.getByRole("button", { name: "Allow proxy-int.corp" }));

    fireEvent.click(screen.getByRole("button", { name: "Allow proxy-int.corp" }));
    const saveBar = await waitFor(() => screen.getByTestId("settings-save-bar"));
    expect(within(saveBar).getByRole("button", { name: "Security" })).toBeTruthy();

    fireEvent.click(screen.getByTestId("save-btn"));
    await waitFor(() => expect(panelPutCalls().length).toBeGreaterThan(0));
    const put = panelPutCalls()[0];
    expect(put.body).toMatchObject({ allowedHosts: ["proxy-int.corp"] });
  });

  // test-plan #F6 — rows hidden by the draft stay hidden across refetches.
  it("keeps a drafted host hidden from Recent refusals after refetch", async () => {
    gateFixture = {
      ...GATE_DEFAULT,
      recent: [{ host: "proxy-int.corp", count: 1, lastSeen: 1, outcome: "would-refuse" }],
    };
    vi.useFakeTimers();
    try {
      global.fetch = mockPanelFetch();
      setPath("/settings/security");
      render(<SettingsPanel />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByRole("button", { name: "Allow proxy-int.corp" })).toBeTruthy();

      // Draft the host — the row hides at render, from the DRAFT value.
      fireEvent.change(screen.getByTestId("host-gate-extra"), { target: { value: "proxy-int.corp" } });
      expect(screen.queryByRole("button", { name: "Allow proxy-int.corp" })).toBeNull();

      // The poll tick refetches; the same row comes back and stays hidden.
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      expect(screen.queryByRole("button", { name: "Allow proxy-int.corp" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
