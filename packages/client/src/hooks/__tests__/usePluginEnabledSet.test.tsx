/**
 * `usePluginEnabledSet` clears the folder-project cache only when the enabled
 * set CHANGES (test-plan F9). See change: add-project-scoped-apps.
 */
import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePluginEnabledSet } from "../usePluginEnabledSet.js";

const clearFolderProjects = vi.hoisted(() => vi.fn());
vi.mock("@blackbelt-technology/dashboard-plugin-runtime", async (orig) => ({
  ...(await orig<typeof import("@blackbelt-technology/dashboard-plugin-runtime")>()),
  clearFolderProjects,
}));

let plugins: Array<{ id: string; enabled?: boolean }>;

beforeEach(() => {
  clearFolderProjects.mockClear();
  plugins = [{ id: "a" }, { id: "b" }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ plugins, startedAt: "2026-01-01T00:00:00Z" }) })),
  );
});
afterEach(() => vi.unstubAllGlobals());

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const refreshEvent = () => act(async () => {
  window.dispatchEvent(new Event("plugin-config-update"));
  await new Promise((r) => setTimeout(r, 0));
});

describe("usePluginEnabledSet → folder project cache", () => {
  it("F9: an unchanged refresh keeps the cache; a changed set clears it", async () => {
    renderHook(() => usePluginEnabledSet(createSlotRegistry()));
    await flush();
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
