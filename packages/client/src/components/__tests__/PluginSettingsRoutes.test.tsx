/**
 * Route resolution, page rendering, and nav-rail membership for the per-plugin
 * settings pages at `/settings/plugins/<id>`.
 *
 * Runs against real wouter + jsdom history (no route mock) so the two
 * consecutive optional segments of `/settings/:page?/:sub?` are exercised for
 * real, including the `replace`-redirect path that used to bounce a bookmarked
 * plugin page to General.
 *
 * Covers test-plan rows E1-E11.
 * See change: plugin-settings-pages.
 */
import { intentStore } from "@blackbelt-technology/dashboard-plugin-runtime";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../settings/SettingsPanel.js";

const { fetchAutoInitWorktreePref, setAutoInitWorktreePref } = vi.hoisted(() => ({
  fetchAutoInitWorktreePref: vi.fn(),
  setAutoInitWorktreePref: vi.fn(),
}));
vi.mock("../../lib/git/git-api.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../lib/git/git-api.js")>("../../lib/git/git-api.js");
  return { ...actual, fetchAutoInitWorktreePref, setAutoInitWorktreePref };
});

vi.mock("../../lib/api/model-proxy-api.js", () => ({
  listApiKeys: vi.fn().mockResolvedValue({ keys: [], revoked: [] }),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn().mockResolvedValue(undefined),
  deleteApiKey: vi.fn().mockResolvedValue(undefined),
  refreshRegistry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../hooks/usePackageOperations.js", () => ({
  usePackageOperations: () => ({
    install: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
    statusFor: () => "idle",
    messageFor: () => "",
  }),
}));

const mockConfig = {
  port: 8000,
  piPort: 9999,
  autoStart: true,
  autoShutdown: true,
  shutdownIdleSeconds: 300,
  spawnStrategy: "headless",
  tunnel: { enabled: true },
  devBuildOnReload: false,
  memoryLimits: {
    maxEventsPerSession: 200,
    maxStringFieldSize: 4000,
    maxWsBufferBytes: 4194304,
  },
};

interface RowOpts {
  id: string;
  displayName?: string;
  enabled?: boolean;
  loaded?: boolean;
  error?: string;
  claims?: boolean;
  dependsOn?: string[];
}

function pluginRow(o: RowOpts) {
  return {
    id: o.id,
    displayName: o.displayName ?? o.id,
    priority: 100,
    hasServer: false,
    hasBridge: false,
    hasClient: true,
    claims: o.claims === false ? [] : [{ slot: "settings-section", component: "S" }],
    requires: null,
    ...(o.dependsOn ? { dependsOn: o.dependsOn } : {}),
    status: {
      id: o.id,
      displayName: o.displayName ?? o.id,
      enabled: o.enabled ?? true,
      loaded: o.loaded ?? true,
      claims: o.claims === false ? 0 : 1,
      missingRequirements: [],
      ...(o.error ? { error: o.error } : {}),
    },
  };
}

function mockFetch(rows: ReturnType<typeof pluginRow>[]) {
  return vi.fn().mockImplementation((url: string, options?: any) => {
    if (url === "/api/config" && !options?.method) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockConfig }),
      });
    }
    if (url.endsWith("/api/plugins")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, plugins: rows }),
      });
    }
    if (url.includes("/api/health")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, startedAt: "2025-01-01T00:00:00Z" }),
      });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  });
}

function setPath(path: string) {
  window.history.replaceState({}, "", path);
}

async function mount(path: string, rows: ReturnType<typeof pluginRow>[]) {
  setPath(path);
  vi.stubGlobal("fetch", mockFetch(rows));
  render(<SettingsPanel />);
  await screen.findByTestId("settings-nav-rail");
}

beforeEach(() => {
  vi.restoreAllMocks();
  fetchAutoInitWorktreePref.mockResolvedValue(false);
  setAutoInitWorktreePref.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  intentStore.__resetForTests();
});

/** Simulate a server-broadcast settings-section intent for `pluginId`. */
function broadcastSettingsIntent(pluginId: string) {
  act(() => {
    intentStore.set(
      { pluginId, sessionId: null, slot: "settings-section" },
      { primitive: "ui:status-pill", props: { text: "from-intent" } },
    );
  });
}

describe("plugin settings routes", () => {
  // (test-plan #E1)
  it("resolves /settings/plugins/<id> to that plugin's page, with no redirect", async () => {
    await mount("/settings/plugins/roles", [pluginRow({ id: "roles", displayName: "Roles" })]);
    expect(await screen.findByTestId("plugin-settings-page-roles")).toBeTruthy();
    expect(screen.getByTestId("plugin-page-title").textContent).toBe("Roles");
    // The old single-segment pattern `replace`d a deep link to General.
    expect(window.location.pathname).toBe("/settings/plugins/roles");
  });

  // (test-plan #E2)
  it("resolves the bare /settings/plugins route to the activation index", async () => {
    await mount("/settings/plugins", [pluginRow({ id: "roles", displayName: "Roles" })]);
    expect(await screen.findByTestId("plugins-section")).toBeTruthy();
    expect(screen.queryByTestId("plugin-settings-page-roles")).toBeNull();
    expect(screen.queryByTestId("plugin-not-found-notice")).toBeNull();
  });

  // (test-plan #E3) — plugin ids come from URLs users paste.
  it("falls back to the index with a notice for an unknown plugin id", async () => {
    await mount("/settings/plugins/not-installed", [pluginRow({ id: "roles" })]);
    expect(await screen.findByTestId("plugin-not-found-notice")).toBeTruthy();
    expect(screen.getByTestId("plugins-section")).toBeTruthy();
    expect(window.location.pathname).toBe("/settings/plugins/not-installed");
  });

  // (test-plan #E4) — not an empty-bodied plugin page.
  it("falls back to the index for an installed plugin with no settings claim", async () => {
    await mount("/settings/plugins/demo", [pluginRow({ id: "demo", claims: false })]);
    expect(await screen.findByTestId("plugin-not-found-notice")).toBeTruthy();
    expect(screen.queryByTestId("plugin-settings-page-demo")).toBeNull();
  });

  // (test-plan #E5) — `:sub` is interpreted ONLY under `plugins`.
  it("ignores a trailing segment on a non-plugins page", async () => {
    await mount("/settings/server/anything", []);
    await waitFor(() => {
      expect(screen.getByTestId("settings-content").textContent).toContain("HTTP Port");
    });
    expect(window.location.pathname).toBe("/settings/server/anything");
  });

  // (test-plan #E11) — PluginRow has no version/description/source/icon fields.
  it("renders chrome from the real field set with no undefined artifacts", async () => {
    await mount("/settings/plugins/flows", [
      pluginRow({ id: "flows", displayName: "Flows", dependsOn: ["roles"] }),
    ]);
    const chrome = await screen.findByTestId("plugin-page-chrome");
    expect(chrome.textContent).not.toContain("undefined");
    expect(chrome.textContent).not.toContain("NaN");
    expect(chrome.textContent).toContain("Flows");
    expect(chrome.textContent).toContain("flows");
    expect(within(chrome).getByTestId("plugin-page-depends-on").textContent).toContain("roles");
    expect(within(chrome).getByTestId("plugin-page-slots").textContent).toContain(
      "settings-section",
    );
  });

  // Design D1: the chrome is unconditional — a plugin body that renders nothing
  // still yields a full header.
  it("renders full chrome even when the plugin body renders nothing", async () => {
    await mount("/settings/plugins/roles", [pluginRow({ id: "roles", displayName: "Roles" })]);
    const chrome = await screen.findByTestId("plugin-page-chrome");
    expect(within(chrome).getByTestId("plugin-page-title")).toBeTruthy();
    expect(within(chrome).getByTestId("plugin-page-toggle-roles")).toBeTruthy();
  });

  // Design D6: chrome only, no body, plus a re-enable affordance.
  it("renders a disabled plugin's page as chrome + notice, never a body", async () => {
    await mount("/settings/plugins/subagents", [
      pluginRow({ id: "subagents", displayName: "Subagents", enabled: false }),
    ]);
    expect(await screen.findByTestId("plugin-page-chrome")).toBeTruthy();
    expect(screen.getByTestId("plugin-page-disabled-notice")).toBeTruthy();
    expect(screen.getByTestId("plugin-page-reenable-btn")).toBeTruthy();
  });
});

describe("plugin nav-rail membership", () => {
  // (test-plan #E8) — decision table over {enabled} × {claims}.
  it("lists exactly the enabled plugins that contribute settings", async () => {
    await mount("/settings/plugins", [
      pluginRow({ id: "yes-yes", displayName: "YesYes" }),
      pluginRow({ id: "yes-no", displayName: "YesNo", claims: false }),
      pluginRow({ id: "no-yes", displayName: "NoYes", enabled: false }),
      pluginRow({ id: "no-no", displayName: "NoNo", enabled: false, claims: false }),
    ]);
    const rail = screen.getByTestId("settings-nav-rail");
    await waitFor(() => {
      expect(within(rail).getByTestId("nav-plugin-yes-yes")).toBeTruthy();
    });
    expect(within(rail).queryByTestId("nav-plugin-yes-no")).toBeNull();
    expect(within(rail).queryByTestId("nav-plugin-no-yes")).toBeNull();
    expect(within(rail).queryByTestId("nav-plugin-no-no")).toBeNull();
  });

  // (test-plan #E9) — membership keys on `enabled`, NOT `loaded`: a failed
  // plugin is exactly when the user needs to reach its page.
  it("keeps an enabled-but-failed plugin in the rail, flagged", async () => {
    await mount("/settings/plugins", [
      pluginRow({
        id: "automation",
        displayName: "Automation",
        loaded: false,
        error: "Bridge path conflict",
      }),
    ]);
    const rail = screen.getByTestId("settings-nav-rail");
    await waitFor(() => {
      expect(within(rail).getByTestId("nav-plugin-automation")).toBeTruthy();
    });
    const dot = within(rail).getByTestId("nav-plugin-status-automation");
    expect(dot.className).toContain("--accent-red");
  });

  // (test-plan #E10)
  it("orders children alphabetically by display name", async () => {
    await mount("/settings/plugins", [
      pluginRow({ id: "roles", displayName: "Roles" }),
      pluginRow({ id: "automation", displayName: "Automation" }),
      pluginRow({ id: "flows", displayName: "Flows" }),
    ]);
    const rail = screen.getByTestId("settings-nav-rail");
    await waitFor(() => {
      expect(within(rail).getByTestId("nav-plugin-roles")).toBeTruthy();
    });
    const order = Array.from(rail.querySelectorAll("[data-testid^='nav-plugin-']"))
      .map((el) => el.getAttribute("data-testid"))
      .filter((id): id is string => !!id && !id.startsWith("nav-plugin-status-"));
    expect(order).toEqual(["nav-plugin-automation", "nav-plugin-flows", "nav-plugin-roles"]);
  });

  // Design D8a: exactly one active entry; the parent is active only on the index.
  it("marks the child active on a plugin page and the parent active on the index", async () => {
    await mount("/settings/plugins/roles", [pluginRow({ id: "roles", displayName: "Roles" })]);
    const rail = screen.getByTestId("settings-nav-rail");
    await waitFor(() => {
      expect(within(rail).getByTestId("nav-plugin-roles")).toBeTruthy();
    });
    const active = Array.from(rail.querySelectorAll("[aria-current='page']"));
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute("data-testid")).toBe("nav-plugin-roles");
  });

  it("marks the Plugins parent active on the activation index", async () => {
    await mount("/settings/plugins", [pluginRow({ id: "roles", displayName: "Roles" })]);
    const rail = screen.getByTestId("settings-nav-rail");
    await waitFor(() => {
      expect(within(rail).getByTestId("nav-plugin-roles")).toBeTruthy();
    });
    const active = Array.from(rail.querySelectorAll("[aria-current='page']"));
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute("data-testid")).toBeNull();
    expect(active[0].textContent).toContain("Plugins");
  });

  // (test-plan #X7) — a failing plugin list must not take Settings down.
  it("renders the rail without children when GET /api/plugins fails", async () => {
    setPath("/settings/general");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, options?: any) => {
        if (url === "/api/config" && !options?.method) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, data: mockConfig }),
          });
        }
        if (url.endsWith("/api/plugins")) {
          return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve(null) });
        }
        return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
      }),
    );
    render(<SettingsPanel />);
    const rail = await screen.findByTestId("settings-nav-rail");
    expect(within(rail).getByRole("button", { name: /Plugins/ })).toBeTruthy();
    expect(rail.querySelectorAll("[data-testid^='nav-plugin-']")).toHaveLength(0);
  });
});

// A plugin may contribute a settings section by INTENT BROADCAST alone, with no
// `settings-section` claim in its manifest — JSON-Schema descriptor
// contributions arrive this way. `PluginRow.claims` is built from the manifest
// only (`plugin-activation-routes.ts`), so a claims-only membership test would
// bounce such a plugin to the not-found notice and its intent would never reach
// the slot that renders it — silently dropping the contribution the flip was
// required to preserve (design D7).
describe("intent-only plugins are first-class", () => {
  it("gives an intent-only plugin a page instead of the not-found notice", async () => {
    await mount("/settings/plugins/intentional", [
      pluginRow({ id: "intentional", displayName: "Intentional", claims: false }),
    ]);
    // Without the intent it is correctly treated as settings-less.
    expect(await screen.findByTestId("plugin-not-found-notice")).toBeTruthy();

    broadcastSettingsIntent("intentional");

    await waitFor(() => {
      expect(screen.getByTestId("plugin-settings-page-intentional")).toBeTruthy();
    });
    expect(screen.queryByTestId("plugin-not-found-notice")).toBeNull();
  });

  it("lists an intent-only plugin in the nav rail", async () => {
    await mount("/settings/plugins", [
      pluginRow({ id: "intentional", displayName: "Intentional", claims: false }),
    ]);
    const rail = screen.getByTestId("settings-nav-rail");
    expect(within(rail).queryByTestId("nav-plugin-intentional")).toBeNull();

    broadcastSettingsIntent("intentional");

    await waitFor(() => {
      expect(within(rail).getByTestId("nav-plugin-intentional")).toBeTruthy();
    });
  });

  it("still hides a disabled intent-only plugin from the rail", async () => {
    await mount("/settings/plugins", [
      pluginRow({ id: "intentional", displayName: "Intentional", claims: false, enabled: false }),
    ]);
    broadcastSettingsIntent("intentional");
    const rail = screen.getByTestId("settings-nav-rail");
    await waitFor(() => {
      expect(screen.getByTestId("plugins-section")).toBeTruthy();
    });
    expect(within(rail).queryByTestId("nav-plugin-intentional")).toBeNull();
  });
});
