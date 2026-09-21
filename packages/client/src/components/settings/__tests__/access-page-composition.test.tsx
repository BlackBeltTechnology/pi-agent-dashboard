/**
 * Access-page composition (change: add-access-grants-and-review, tasks
 * 7.1 / 7.4 / 7.5 / 7.6 / 7.7 / 7.9 / 7.13).
 *
 * Harness glue copied from ./settings-page-composition.test.tsx.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../SettingsPanel.js";

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

/** Mutable per-test aggregate snapshot served by GET /api/access/grants. */
let accessFixture: Record<string, unknown> | null = null;

/** Every fetch, recorded for the zero-writes assertion (task 7.7). */
const fetchCalls: Array<{ url: string; method?: string }> = [];

function jsonOk(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve({ success: true, data }) };
}

function mockFetch() {
  return vi.fn().mockImplementation((url: string, options?: { method?: string; body?: string }) => {
    fetchCalls.push({ url, method: options?.method });
    const method = options?.method ?? "GET";
    if (url === "/api/access/grants" && method === "GET") {
      return Promise.resolve(jsonOk(accessFixture));
    }
    if (url === "/api/access/grants" && method === "DELETE") {
      const body = JSON.parse(options!.body!) as { subject: string; scope: string };
      const grants = accessFixture as { pathGrants: Array<{ subject: string; scope: string }> };
      grants.pathGrants = grants.pathGrants.filter(
        (g) => !(g.subject === body.subject && g.scope === body.scope),
      );
      return Promise.resolve(jsonOk(accessFixture));
    }
    if (url === "/api/kb/source-trust" && method === "DELETE") {
      const body = JSON.parse(options!.body!) as { hash: string };
      const grants = accessFixture as { kbTrust: Array<{ hash: string }> };
      grants.kbTrust = grants.kbTrust.filter((k) => k.hash !== body.hash);
      return Promise.resolve(jsonOk(accessFixture));
    }
    if (url === "/api/config" && method === "GET") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: mockConfig }) });
    }
    if (url === "/api/config" && method === "PUT") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
  });
}

function setPath(path: string) {
  window.history.replaceState({}, "", path);
}

function gotoPage(name: string) {
  const rail = screen.getByTestId("settings-nav-rail");
  fireEvent.click(within(rail).getByRole("button", { name }));
}

function grantsFixture() {
  return {
    pathGrants: [
      { subject: "/repo/persisted", scope: "project", grantedAt: "2026-01-01T00:00:00Z", origin: "sess-a" },
      { subject: "/repo/ephemeral", scope: "session", grantedAt: "2026-01-02T00:00:00Z", origin: "sess-b" },
    ],
    worktreeTrust: [],
    kbTrust: [{ hash: "c0ffee00" }],
    projectTrust: [],
    trustedNetworks: ["192.168.1.0/24"],
    bypassHosts: ["nas.local"],
    corsOrigins: [],
    pinnedDirectories: [],
  };
}

describe("settings access page", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls.length = 0;
    setPath("/settings/general");
    global.fetch = mockFetch();
  });

  afterEach(() => cleanup());

  // 7.1 — the tab is in the nav rail and routes to its page id.
  it("adds the Access page to the nav and routes /settings/access", async () => {
    render(<SettingsPanel />);
    await waitFor(() => screen.getByText("Interface"));

    gotoPage("Access");
    await waitFor(() => expect(window.location.pathname).toBe("/settings/access"));
    const section = await waitFor(() => screen.getByTestId("access-section"));
    expect(section).toBeTruthy();
  });

  // 7.4 — empty snapshot renders the empty state, not an error.
  it("renders the empty state when no store holds a grant", async () => {
    accessFixture = {
      pathGrants: [], worktreeTrust: [], kbTrust: [], projectTrust: [],
      trustedNetworks: [], bypassHosts: [], corsOrigins: [], pinnedDirectories: [],
    };
    setPath("/settings/access");
    render(<SettingsPanel />);

    const empty = await waitFor(() => screen.getByTestId("access-empty-state"));
    expect(within(empty).getByText("No access grants")).toBeTruthy();
    expect(screen.queryByTestId("access-error")).toBeNull();
    // And no entry rows at all.
    expect(screen.queryByTestId("access-entry")).toBeNull();
  });

  // 7.7 — opening the page performs ZERO store writes: every request is a GET.
  it("performs no store writes while loading and rendering the page", async () => {
    accessFixture = grantsFixture();
    setPath("/settings/access");
    render(<SettingsPanel />);

    await waitFor(() => screen.getByTestId("access-section"));
    await waitFor(() => expect(screen.getAllByTestId("access-entry").length).toBeGreaterThan(0));

    const writes = fetchCalls.filter((c) => c.method && c.method !== "GET");
    expect(writes, `render issued writes: ${JSON.stringify(writes)}`).toEqual([]);
  });

  // 7.9 — THE security-relevant one: no control on the page can create a
  // grant for an arbitrary subject (design D12). The only buttons are revokes.
  it("offers no grant-creation control — revoke buttons only", async () => {
    accessFixture = grantsFixture();
    setPath("/settings/access");
    render(<SettingsPanel />);
    await waitFor(() => screen.getByTestId("access-section"));
    await waitFor(() => expect(screen.getAllByTestId("access-entry").length).toBeGreaterThan(0));

    const section = screen.getByTestId("access-section");
    const buttons = within(section).getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.getAttribute("data-testid"), "non-revoke button found").toBe("access-revoke");
    }
    // No free-form input, picker, or combobox that could name a subject.
    expect(within(section).queryAllByRole("textbox")).toEqual([]);
    expect(within(section).queryAllByRole("combobox")).toEqual([]);
    // And the page says so.
    expect(screen.getByTestId("access-review-only").textContent).toMatch(/never here/);
  });

  // 7.5 (UI half) + 7.13 — session grant renders all four fields and revokes
  // against the path-grant store; the row disappears without a restart.
  it("lists a session-scoped grant with all four fields and revokes it", async () => {
    accessFixture = grantsFixture();
    setPath("/settings/access");
    render(<SettingsPanel />);
    await waitFor(() => screen.getByTestId("access-section"));

    const rows = await waitFor(() => screen.getAllByTestId("access-entry"));
    const sessionRow = rows.find((r) => r.getAttribute("data-store") === "pathGrants" &&
      r.textContent?.includes("/repo/ephemeral"));
    expect(sessionRow).toBeDefined();
    expect(sessionRow!.textContent).toContain("Session (server process)");
    expect(sessionRow!.textContent).toContain("2026-01-02T00:00:00Z");
    expect(sessionRow!.textContent).toContain("sess-b");

    fireEvent.click(within(sessionRow!).getByTestId("access-revoke"));
    await waitFor(() =>
      expect(
        screen.getAllByTestId("access-entry").some((r) => r.textContent?.includes("/repo/ephemeral")),
      ).toBe(false),
    );
    expect(screen.queryByTestId("access-revoke-error")).toBeNull();
    // The delete went to the path-grant store's own route.
    const revoke = fetchCalls.find((c) => c.method === "DELETE" && c.url === "/api/access/grants");
    expect(revoke).toBeDefined();
  });

  // 7.6 — legacy hash-only KB entry renders as an opaque hash with a working
  // revoke, and never errors.
  it("renders a legacy hash-only KB entry as an opaque hash with a working revoke", async () => {
    accessFixture = grantsFixture();
    setPath("/settings/access");
    render(<SettingsPanel />);
    await waitFor(() => screen.getByTestId("access-section"));

    const row = await waitFor(() => {
      const rows = screen.getAllByTestId("access-entry");
      const found = rows.find((r) => r.getAttribute("data-store") === "kbTrust");
      expect(found, "kbTrust row missing").toBeDefined();
      return found!;
    });
    expect(row.textContent).toContain("c0ffee00");
    expect(row.querySelector('[data-testid="access-legacy-hash"]')).not.toBeNull();

    fireEvent.click(within(row).getByTestId("access-revoke"));
    await waitFor(() =>
      expect(
        screen.getAllByTestId("access-entry").some((r) => r.getAttribute("data-store") === "kbTrust"),
      ).toBe(false),
    );
    expect(screen.queryByTestId("access-error")).toBeNull();
    expect(screen.queryByTestId("access-revoke-error")).toBeNull();
    const revoke = fetchCalls.find((c) => c.method === "DELETE" && c.url === "/api/kb/source-trust");
    expect(revoke).toBeDefined();
  });

  // 7.2 (UI half) — both host-plane stores render under their OWN store
  // labels, so a revoke targets the correct field.
  it("lists bypassHosts and trustedNetworks under distinct store headings", async () => {
    accessFixture = grantsFixture();
    setPath("/settings/access");
    render(<SettingsPanel />);
    await waitFor(() => screen.getByTestId("access-section"));

    const bypass = await waitFor(() => screen.getByTestId("access-store-bypassHosts"));
    const networks = screen.getByTestId("access-store-trustedNetworks");
    expect(bypass.textContent).toContain("nas.local");
    expect(bypass.textContent).toContain("auth.bypassHosts");
    expect(networks.textContent).toContain("192.168.1.0/24");
    expect(networks.textContent).toContain("config.trustedNetworks");
  });
});
