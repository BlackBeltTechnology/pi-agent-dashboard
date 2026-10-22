/** Test-plan #E11 — `useEmbedMode` (design D5). See change: add-session-ui-deep-links-for-agents. */
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { EMBED_STORAGE_KEY, useEmbedMode } from "../useEmbedMode.js";

beforeEach(() => window.sessionStorage.clear());

describe("useEmbedMode", () => {
  it("E11: ?embed=1 turns it on and sticks; ?embed=0 turns it off and clears the key", () => {
    const { hook, searchHook, navigate } = memoryLocation({ path: "/session/x", searchPath: "embed=1" });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Router hook={hook} searchHook={searchHook}>
        {children}
      </Router>
    );
    const { result } = renderHook(() => useEmbedMode(), { wrapper });
    expect(result.current).toBe(true);
    expect(window.sessionStorage.getItem(EMBED_STORAGE_KEY)).toBe("1");

    act(() => navigate("/session/x/diff")); // no query: embed persists in-app
    expect(result.current).toBe(true);

    act(() => navigate("/?embed=0"));
    expect(result.current).toBe(false);
    expect(window.sessionStorage.getItem(EMBED_STORAGE_KEY)).toBeNull();

    act(() => navigate("/session/x"));
    expect(result.current).toBe(false);
  });

  it("is off in a tab that never saw ?embed=1", () => {
    const { hook, searchHook } = memoryLocation({ path: "/session/x" });
    const { result } = renderHook(() => useEmbedMode(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Router hook={hook} searchHook={searchHook}>
          {children}
        </Router>
      ),
    });
    expect(result.current).toBe(false);
  });
});
