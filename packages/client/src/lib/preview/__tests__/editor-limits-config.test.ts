// See change: gate-changed-on-disk-by-content (D6).
import { MAX_PREVIEW_BYTES } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetEditorLimitsConfig,
  getEditorLimitsSnapshot,
  hydrateEditorLimitsConfig,
  resolveEditorLimitBytes,
  useEditorLimits,
} from "../editor-limits-config.js";

const MB = 1024 * 1024;

afterEach(() => __resetEditorLimitsConfig());

describe("editor-limits-config", () => {
  it("starts at the default, not loaded", () => {
    expect(resolveEditorLimitBytes()).toBe(MAX_PREVIEW_BYTES);
    expect(getEditorLimitsSnapshot().loaded).toBe(false);
  });

  it("hydrates from an /api/config response", () => {
    hydrateEditorLimitsConfig({ success: true, data: { editor: { largeFileLimitMb: 64 } } });
    expect(resolveEditorLimitBytes()).toBe(64 * MB);
    expect(getEditorLimitsSnapshot().loaded).toBe(true);
  });

  it("an invalid value resolves to the default bytes but still marks loaded", () => {
    for (const bad of ["64", null, Number.NaN, 0, -3, undefined, {}]) {
      hydrateEditorLimitsConfig({ success: true, data: { editor: { largeFileLimitMb: bad } } });
      expect(resolveEditorLimitBytes()).toBe(MAX_PREVIEW_BYTES);
      expect(getEditorLimitsSnapshot().loaded).toBe(true);
      __resetEditorLimitsConfig();
    }
  });

  it("a missing editor block resolves to the default", () => {
    hydrateEditorLimitsConfig({ success: true, data: {} });
    expect(resolveEditorLimitBytes()).toBe(MAX_PREVIEW_BYTES);
    expect(getEditorLimitsSnapshot().loaded).toBe(true);
  });

  it("an unsuccessful response leaves the store untouched", () => {
    hydrateEditorLimitsConfig({ success: true, data: { editor: { largeFileLimitMb: 32 } } });
    hydrateEditorLimitsConfig({ success: false });
    hydrateEditorLimitsConfig(null);
    expect(resolveEditorLimitBytes()).toBe(32 * MB);
  });

  it("notifies subscribers on change only", () => {
    const { result } = renderHook(() => useEditorLimits());
    expect(result.current.loaded).toBe(false);
    act(() => hydrateEditorLimitsConfig({ success: true, data: { editor: { largeFileLimitMb: 64 } } }));
    expect(result.current).toEqual({ bytes: 64 * MB, loaded: true });
    const spy = vi.fn();
    const { result: r2 } = renderHook(() => {
      const v = useEditorLimits();
      spy(v);
      return v;
    });
    spy.mockClear();
    act(() => hydrateEditorLimitsConfig({ success: true, data: { editor: { largeFileLimitMb: 64 } } }));
    expect(spy).not.toHaveBeenCalled(); // identical → no re-render
    expect(r2.current.bytes).toBe(64 * MB);
  });
});
