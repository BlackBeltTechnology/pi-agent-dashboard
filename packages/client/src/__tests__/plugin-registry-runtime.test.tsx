/**
 * Shell consumes the registry (empty, runtime after load) — test-plan #E91 / task 8.114.
 * The populated / co-tenancy halves live in `plugin-registry-populated.test.ts`.
 * See change: decouple-plugins-from-core (tasks 6.14, 6.16).
 */
import { createSlotRegistry, PluginContextProvider, SessionCardBadgeSlot, SettingsSectionByPluginSlot } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PLUGIN_REGISTRY } from "../generated/plugin-registry.js";
import { __resetRuntimeLoaderForTests, loadRuntimePlugins } from "../lib/plugins/runtime-plugin-loader.js";

describe("shell consumes the registry (empty, runtime after load)", () => {
  const session = { id: "s1", cwd: "/repo", source: "tui", status: "active", startedAt: 0 } as DashboardSession;

  it("an empty registry yields 0 contributions and no error", () => {
    const registry = createSlotRegistry();
    for (const entry of [] as typeof PLUGIN_REGISTRY) for (const claim of entry.claims) registry.addClaim(claim); // App's loop over `PLUGIN_REGISTRY = []`
    const { container } = render(
      <PluginContextProvider registry={registry}>
        <SessionCardBadgeSlot session={session} />
        <SettingsSectionByPluginSlot pluginId="demo" />
      </PluginContextProvider>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("a runtime plugin loaded after mount appears in already-mounted consumers", async () => {
    __resetRuntimeLoaderForTests();
    const registry = createSlotRegistry();
    const { container } = render(
      <PluginContextProvider registry={registry}>
        <SessionCardBadgeSlot session={session} />
      </PluginContextProvider>,
    );
    expect(container.querySelector("[data-testid=late-badge]")).toBeNull();
    const sha = "c".repeat(64);
    await act(async () => {
      await loadRuntimePlugins({
        registry,
        buildTimeIds: new Set(),
        buildTimeRoutes: [],
        getApiBase: () => "",
        hasImportMap: () => true,
        fetchListing: async () => [
          { id: "ext", displayName: "Ext", priority: 1, sha256: sha, entry: `/plugin-assets/ext/${sha}/client.js`, eventTypes: [], routes: [], claims: [{ slot: "session-card-badge", component: "Badge" }] },
        ],
        importModule: vi.fn(async () => ({ Badge: () => <span data-testid="late-badge">late</span> })),
      });
    });
    expect(container.querySelector("[data-testid=late-badge]")).not.toBeNull();
    __resetRuntimeLoaderForTests();
  });
});
