/**
 * Regression: clearing a per-session display override live.
 *
 * A clearing `session_updated` broadcast carries `displayPrefsOverride: null`
 * (so the field survives `JSON.stringify`). The client MUST normalize that
 * `null` to `undefined` at the `resolveSessionOverride` seam so the session
 * merges to pure global prefs and the `ChatViewMenu` "modified" pill turns off
 * without a page reload.
 * See change: fix-clear-display-override-broadcast (D2 / D3(b)).
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, renderHook, screen, cleanup } from "@testing-library/react";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { DISPLAY_PRESETS } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { DisplayPrefsProvider, resolveSessionOverride } from "../lib/state/DisplayPrefsContext.js";
import { useDisplayPrefs } from "../hooks/useDisplayPrefs.js";
import { ChatViewMenu } from "../components/chat/ChatViewMenu.js";

afterEach(() => cleanup());

function sessionsWith(override: unknown): Map<string, DashboardSession> {
  return new Map([["s1", { displayPrefsOverride: override } as unknown as DashboardSession]]);
}

describe("clearing a per-session display override", () => {
  it("resolveSessionOverride normalizes a null record to undefined", () => {
    expect(resolveSessionOverride(sessionsWith(null), "s1")).toBeUndefined();
  });

  it("useDisplayPrefs merges to pure global prefs when the override is null", () => {
    const global = { ...DISPLAY_PRESETS.standard };
    const sessions = sessionsWith(null);
    const { result } = renderHook(() => useDisplayPrefs("s1"), {
      wrapper: ({ children }) => (
        <DisplayPrefsProvider
          value={{ global, getSessionOverride: (id) => resolveSessionOverride(sessions, id) }}
        >
          {children}
        </DisplayPrefsProvider>
      ),
    });
    expect(result.current).toEqual(global);
  });

  it("ChatViewMenu does not render the modified pill for a null-normalized override", () => {
    const currentOverride = resolveSessionOverride(sessionsWith(null), "s1");
    render(<ChatViewMenu sessionId="s1" send={() => {}} currentOverride={currentOverride} />);
    expect(screen.queryByTestId("chat-view-modified-pill")).toBeNull();
  });
});
