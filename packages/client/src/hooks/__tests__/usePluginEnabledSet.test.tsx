/**
 * `usePluginEnabledSet` clears the folder-project cache only when the enabled
 * set CHANGES (test-plan F9). See change: add-project-scoped-apps.
 */
import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetPluginAvailabilityForTests, isPluginUnavailable } from "../../lib/plugins/plugin-availability.js";
import { usePluginEnabledSet } from "../usePluginEnabledSet.js";

const clearFolderProjects = vi.hoisted(() => vi.fn());
vi.mock("@blackbelt-technology/dashboard-plugin-runtime/host", async (orig) => ({
  ...(await orig<typeof import("@blackbelt-technology/dashboard-plugin-runtime/host")>()),
  clearFolderProjects,
}));

let plugins: Array<{ id: string; enabled?: boolean; loaded?: boolean }>;

beforeEach(() => {
  clearFolderProjects.mockClear();
  plugins = [{ id: "a" }, { id: "b" }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ plugins, startedAt: "2026-01-01T00:00:00Z" }) })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  __resetPluginAvailabilityForTests();
});

const fetchMock = () => vi.mocked(globalThis.fetch);
/** Dispatch a config update and wait until its `/api/health` refresh has been applied. */
async function refreshEvent() {
  const before = fetchMock().mock.calls.length;
  act(() => {
    window.dispatchEvent(new Event("plugin-config-update"));
  });
  await waitFor(() => expect(fetchMock().mock.calls.length).toBe(before + 1));
  await act(async () => {
    await fetchMock().mock.results[before]?.value;
  });
}

describe("usePluginEnabledSet → folder project cache", () => {
  it("F9: an unchanged refresh keeps the cache; a changed set clears it", async () => {
    renderHook(() => usePluginEnabledSet(createSlotRegistry()));
    await waitFor(() => expect(fetchMock()).toHaveBeenCalledTimes(1));
    await act(async () => {
      await fetchMock().mock.results[0]?.value;
    });
    expect(clearFolderProjects).not.toHaveBeenCalled(); // first load is the baseline

    await refreshEvent(); // same set
    expect(clearFolderProjects).not.toHaveBeenCalled();

    plugins = [{ id: "a" }, { id: "b", enabled: false }];
    await refreshEvent(); // set changed
    expect(clearFolderProjects).toHaveBeenCalledTimes(1);

    await refreshEvent(); // unchanged again
    expect(clearFolderProjects).toHaveBeenCalledTimes(1);
  });
});

// See change: decouple-plugins-from-core (task 2.16): the hook feeds `pluginAvailability`.
describe("usePluginEnabledSet → pluginAvailability", () => {
  it("publishes /api/health.plugins[] availability on mount and on every refresh", async () => {
    plugins = [{ id: "a", enabled: true, loaded: true }, { id: "b", enabled: true, loaded: false }];
    renderHook(() => usePluginEnabledSet(createSlotRegistry()));
    await waitFor(() => expect(isPluginUnavailable("b")).toBe(true));
    expect(isPluginUnavailable("a")).toBe(false);

    plugins = [{ id: "a", enabled: false, loaded: false }, { id: "b", enabled: true, loaded: true }];
    await refreshEvent();
    expect(isPluginUnavailable("a")).toBe(true);
    expect(isPluginUnavailable("b")).toBe(false);
  });
});

// decouple-plugins-from-core task 5.18: `plugins_changed` recomputes the set AND availability from its own snapshot.
describe("usePluginEnabledSet → plugins_changed", () => {
  it("recomputes the enabled set and pluginAvailability from the broadcast snapshot, without a refetch", async () => {
    plugins = [{ id: "a", enabled: true, loaded: true }];
    const registry = createSlotRegistry();
    const setEnabledSet = vi.spyOn(registry, "setEnabledSet");
    renderHook(() => usePluginEnabledSet(registry));
    await waitFor(() => expect(fetchMock()).toHaveBeenCalledTimes(1));
    await act(async () => {
      await fetchMock().mock.results[0]?.value;
    });
    expect(isPluginUnavailable("late")).toBe(false);
    const callsBefore = setEnabledSet.mock.calls.length;

    act(() => {
      window.dispatchEvent(
        new CustomEvent("plugins-changed", {
          detail: { type: "plugins_changed", plugins: [{ id: "a", enabled: true, loaded: true }, { id: "late", enabled: true, loaded: false }, { id: "off", enabled: false, loaded: false }] },
        }),
      );
    });
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    expect(setEnabledSet.mock.calls.length).toBe(callsBefore + 1);
    const set = setEnabledSet.mock.calls.at(-1)?.[0] as Set<string>;
    expect(set.has("late")).toBe(true);
    expect(set.has("off")).toBe(false);
    expect(isPluginUnavailable("late")).toBe(true);
    expect(isPluginUnavailable("a")).toBe(false);
  });
});

// test-plan #E90 / task 6.14 (recompute on registration). See change: decouple-plugins-from-core.
describe("usePluginEnabledSet → enable filter default-allow + recompute triggers", () => {
  const SLOTS = ["settings-section", "session-card-badge", "command-route", "tool-renderer"] as const;
  function registryWithFlows() {
    const registry = createSlotRegistry();
    registry.registerPlugin({ id: "flows", displayName: "Flows" });
    for (const slot of SLOTS) registry.addClaim({ pluginId: "flows", priority: 1, slot });
    return registry;
  }
  const idsIn = (registry: ReturnType<typeof createSlotRegistry>, slot: (typeof SLOTS)[number]) => registry.getClaims(slot).map((c) => c.pluginId);
  async function mount(registry: ReturnType<typeof createSlotRegistry>) {
    const view = renderHook(() => usePluginEnabledSet(registry));
    await waitFor(() => expect(fetchMock()).toHaveBeenCalledTimes(1));
    await act(async () => {
      await fetchMock().mock.results[0]?.value;
    });
    return view;
  }

  it("never set → every claim; health [] → flows shown in every slot (default-allow)", async () => {
    const registry = registryWithFlows();
    for (const slot of SLOTS) expect(idsIn(registry, slot)).toEqual(["flows"]); // filter inactive
    plugins = [];
    await mount(registry);
    for (const slot of SLOTS) expect(idsIn(registry, slot)).toEqual(["flows"]);
  });

  it("health {flows, enabled:false} → flows hidden in every slot, still listed for the activation UI", async () => {
    const registry = registryWithFlows();
    plugins = [{ id: "flows", enabled: false }];
    await mount(registry);
    for (const slot of SLOTS) expect(idsIn(registry, slot)).toEqual([]);
    expect(registry.getAllPluginsForActivationUi().map((p) => p.id)).toContain("flows");
  });

  it("a runtime plugin registered after the health read joins the enabled set: one recompute on registration", async () => {
    const registry = registryWithFlows();
    const setEnabledSet = vi.spyOn(registry, "setEnabledSet");
    plugins = []; // the server's snapshot predates the runtime plugin
    await mount(registry);
    const before = setEnabledSet.mock.calls.length;
    expect(registry.getClaims("session-card-badge").map((c) => c.pluginId)).toEqual(["flows"]);

    registry.registerPlugin({ id: "quota-ui", displayName: "Quota" });
    registry.addClaim({ pluginId: "quota-ui", priority: 2, slot: "session-card-badge" });
    expect(registry.getClaims("session-card-badge").map((c) => c.pluginId)).toEqual(["flows"]); // filtered until recompute
    act(() => {
      window.dispatchEvent(new CustomEvent("runtime-plugins-registered", { detail: { ids: ["quota-ui"], owners: [] } }));
    });
    expect(setEnabledSet.mock.calls.length).toBe(before + 1);
    expect(fetchMock()).toHaveBeenCalledTimes(1); // no refetch
    expect(registry.getClaims("session-card-badge").map((c) => c.pluginId)).toEqual(["flows", "quota-ui"]);
  });

  it("one recompute per trigger: plugin_config_update and plugins_changed each apply exactly once", async () => {
    const registry = registryWithFlows();
    const setEnabledSet = vi.spyOn(registry, "setEnabledSet");
    await mount(registry);
    const base = setEnabledSet.mock.calls.length;
    await refreshEvent();
    expect(setEnabledSet.mock.calls.length).toBe(base + 1);
    act(() => {
      window.dispatchEvent(new CustomEvent("plugins-changed", { detail: { plugins: [] } }));
    });
    expect(setEnabledSet.mock.calls.length).toBe(base + 2);
  });
});
