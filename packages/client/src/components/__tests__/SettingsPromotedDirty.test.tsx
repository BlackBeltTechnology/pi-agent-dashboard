/**
 * Save Bar label + dirty dot follow a PROMOTED plugin page's placement.
 *
 * The plugin body is stubbed (as in settings-page-composition.test.tsx): the
 * behaviour under test only needs a DIRTY draft source filed under the plugin
 * page key `plugins/roles`, which is exactly what the host rewrites a real
 * plugin's draft source to.
 *
 * See change: promote-model-roles-settings (test-plan #F5).
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
vi.mock("../settings/PluginSettingsPage.js", async () => {
  const { createElement } = await import("react");
  const { useSettingsDraftSource } = await import("@blackbelt-technology/dashboard-plugin-runtime");
  return {
    PluginNotFoundNotice: ({ pluginId }: { pluginId: string }) =>
      createElement("div", { "data-testid": "plugin-not-found-notice" }, pluginId),
    PluginSettingsPage: () => {
      useSettingsDraftSource({
        id: "plugin:roles",
        page: "plugins/roles",
        isDirty: true,
        commit: async () => {},
        reset: () => {},
      });
      return createElement("div", { "data-testid": "roles-body-stub" });
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
  tunnel: { enabled: true },
  devBuildOnReload: false,
  memoryLimits: { maxEventsPerSession: 200, maxStringFieldSize: 4000, maxWsBufferBytes: 4194304 },
};

const rolesRow = {
  id: "roles",
  displayName: "Roles",
  priority: 100,
  firstParty: true,
  hasServer: true,
  hasBridge: false,
  hasClient: true,
  claims: [
    {
      slot: "settings-section",
      component: "BuiltInRolesSettings",
      nav: { group: "models", label: "Model roles" },
    },
  ],
  requires: null,
  status: { id: "roles", displayName: "Roles", enabled: true, loaded: true, claims: 1 },
};

beforeEach(() => {
  fetchAutoInitWorktreePref.mockResolvedValue(false);
  setAutoInitWorktreePref.mockResolvedValue(true);
  window.history.replaceState({}, "", "/settings/plugins/roles");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, options?: { method?: string }) => {
      if (url === "/api/config" && !options?.method) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: mockConfig }) });
      }
      if (url.endsWith("/api/plugins")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, plugins: [rolesRow] }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("promoted page dirty state", () => {
  it("F5: Save Bar reads Models › Model roles and the dirty dot sits on the Models entry only", async () => {
    render(<SettingsPanel />);
    const chip = await screen.findByTestId("save-bar-page-plugins/roles");
    expect(chip.textContent).toContain("Models › Model roles");
    expect(chip.textContent).not.toContain("Plugins");
    const rail = screen.getByTestId("settings-nav-rail");
    await waitFor(() => {
      const entry = within(rail).getByTestId("nav-promoted-roles");
      expect(within(entry).getByTestId("nav-dirty-plugins/roles")).toBeTruthy();
    });
    expect(within(rail).getAllByTestId("nav-dirty-plugins/roles")).toHaveLength(1);
    expect(within(within(rail).getByTestId("nav-plugin-pointer-roles")).queryByTestId("nav-dirty-plugins/roles")).toBeNull();
  });
});
