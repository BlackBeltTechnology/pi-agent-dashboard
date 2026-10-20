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
