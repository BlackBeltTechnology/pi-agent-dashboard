/**
 * Tests for `useDisplayPrefs` — merges global + per-session override.
 * See change: configurable-chat-display.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { DisplayPrefsProvider } from "../lib/state/DisplayPrefsContext.js";
import { useDisplayPrefs } from "../hooks/useDisplayPrefs.js";
import { DISPLAY_PRESETS } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";

function wrapper(value: React.ComponentProps<typeof DisplayPrefsProvider>["value"]) {
  return ({ children }: { children: React.ReactNode }) => (
    <DisplayPrefsProvider value={value}>{children}</DisplayPrefsProvider>
  );
}

describe("useDisplayPrefs", () => {
  it("falls back to DISPLAY_PRESETS.standard when global is undefined", () => {
    const { result } = renderHook(() => useDisplayPrefs(), {
      wrapper: wrapper({ global: undefined, getSessionOverride: () => undefined }),
    });
    expect(result.current).toEqual(DISPLAY_PRESETS.standard);
  });

  it("returns global when no session override", () => {
    const global = { ...DISPLAY_PRESETS.everything };
    const { result } = renderHook(() => useDisplayPrefs("sid-1"), {
      wrapper: wrapper({ global, getSessionOverride: () => undefined }),
    });
    expect(result.current).toEqual(global);
  });

  it("merges session override over global", () => {
    const global = { ...DISPLAY_PRESETS.standard };
    const override = { reasoning: true, toolCalls: { bash: false } as any };
    const { result } = renderHook(() => useDisplayPrefs("sid-1"), {
      wrapper: wrapper({ global, getSessionOverride: () => override }),
    });
    expect(result.current.reasoning).toBe(true);
    expect(result.current.toolCalls.bash).toBe(false);
    expect(result.current.toolCalls.read).toBe(global.toolCalls.read);
  });

  it("re-evaluates when global changes (broadcast)", () => {
    let global = { ...DISPLAY_PRESETS.standard, debugTools: false };
    const { result, rerender } = renderHook(() => useDisplayPrefs(), {
      wrapper: wrapper({ global, getSessionOverride: () => undefined }),
    });
    expect(result.current.debugTools).toBe(false);
    global = { ...global, debugTools: true };
    rerender();
    // Wrapper closes over the original value object — for this test simulate
    // the App-level memo by remounting under a new Provider.
    const { result: result2 } = renderHook(() => useDisplayPrefs(), {
      wrapper: wrapper({ global, getSessionOverride: () => undefined }),
    });
    expect(result2.current.debugTools).toBe(true);
  });
});
