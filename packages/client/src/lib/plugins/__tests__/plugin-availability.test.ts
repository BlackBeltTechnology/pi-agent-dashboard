import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetPluginAvailabilityForTests,
  applyPluginStatuses,
  isPluginUnavailable,
  pluginAvailability,
  usePluginAvailability,
} from "../plugin-availability.js";

afterEach(() => __resetPluginAvailabilityForTests());

describe("pluginAvailability", () => {
  it("counts every plugin available before the first status read", () => {
    expect(isPluginUnavailable("subagents")).toBe(false);
  });

  it("is unavailable when disabled, not loaded, or its client is refused", () => {
    applyPluginStatuses([
      { id: "ok", enabled: true, loaded: true },
      { id: "off", enabled: false, loaded: false },
      { id: "failed", enabled: true, loaded: false },
      { id: "refused", enabled: true, loaded: true, client: { delivery: "refused" } },
    ]);
    expect(["ok", "off", "failed", "refused"].map(isPluginUnavailable)).toEqual([false, true, true, true]);
  });

  it("treats an id the server does not list as available (default-allow)", () => {
    applyPluginStatuses([{ id: "x", enabled: false }]);
    expect(isPluginUnavailable("never-listed")).toBe(false);
  });

  it("notifies subscribers only when availability actually changes", () => {
    const { result } = renderHook(() => usePluginAvailability());
    const first = result.current;
    act(() => applyPluginStatuses([{ id: "a", enabled: true, loaded: true }]));
    const second = result.current;
    expect(second).not.toBe(first);
    // identical re-read: same snapshot, no re-render churn
    act(() => applyPluginStatuses([{ id: "a", enabled: true, loaded: true }]));
    expect(result.current).toBe(second);
    act(() => applyPluginStatuses([{ id: "a", enabled: false, loaded: true }]));
    expect(result.current.isUnavailable("a")).toBe(true);
  });

  it("exposes the same operations as one handle", () => {
    expect(pluginAvailability.isUnavailable("z")).toBe(false);
    pluginAvailability.apply([{ id: "z", enabled: false }]);
    expect(pluginAvailability.isUnavailable("z")).toBe(true);
    pluginAvailability.reset();
    expect(pluginAvailability.isUnavailable("z")).toBe(false);
  });
});
