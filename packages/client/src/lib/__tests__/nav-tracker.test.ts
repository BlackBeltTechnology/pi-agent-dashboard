/**
 * Tests for the in-app depth-tagged nav tracker (change: fix-mobile-back-depth-aware).
 *
 * The tracker maintains a stack of `{ url, depth }` so the back action can ask
 * "is the predecessor a strictly-shallower in-app route?" — unanswerable from
 * the browser history alone.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resetNavStack,
  recordNavigation,
  predecessor,
  popNav,
  handlePopState,
  initNavTracker,
} from "../nav/nav-tracker.js";

describe("nav-tracker", () => {
  beforeEach(() => resetNavStack());

  it("tags each appended entry with its derived depth", () => {
    resetNavStack("/");
    recordNavigation("/session/A");
    expect(predecessor()).toEqual({ url: "/", depth: 0 });
    recordNavigation("/folder/Zm9v/openspec/archive");
    expect(predecessor()).toEqual({ url: "/session/A", depth: 1 });
  });

  it("dedupes consecutive identical-url appends (StrictMode guard)", () => {
    resetNavStack("/");
    recordNavigation("/session/A");
    recordNavigation("/session/A");
    // predecessor is still "/", not a duplicate "/session/A"
    expect(predecessor()).toEqual({ url: "/", depth: 0 });
  });

  it("replace-style nav overwrites the stack top instead of appending", () => {
    resetNavStack("/");
    recordNavigation("/session/A");
    recordNavigation("/", { replace: true });
    // top replaced /session/A with /, predecessor unchanged
    expect(predecessor()).toEqual({ url: "/", depth: 0 });
  });

  it("predecessor() returns undefined with fewer than 2 entries", () => {
    expect(predecessor()).toBeUndefined();
    resetNavStack("/");
    expect(predecessor()).toBeUndefined();
  });

  it("popNav drops the top entry", () => {
    resetNavStack("/");
    recordNavigation("/session/A");
    expect(predecessor()).toEqual({ url: "/", depth: 0 });
    popNav();
    expect(predecessor()).toBeUndefined();
  });

  it("popstate to predecessor url pops the stack top (browser back)", () => {
    resetNavStack("/");
    recordNavigation("/session/A");
    expect(predecessor()).toEqual({ url: "/", depth: 0 });
    handlePopState("/");
    // back to "/" — top popped, only one entry remains
    expect(predecessor()).toBeUndefined();
  });

  it("popstate to an unknown url records it as a navigation (forward/realign)", () => {
    resetNavStack("/");
    recordNavigation("/session/A");
    handlePopState("/session/B");
    expect(predecessor()).toEqual({ url: "/session/A", depth: 1 });
  });

  // History-observation patch: plugin components + session-card routing call
  // wouter's raw `useLocation` (→ history.pushState) directly, bypassing App's
  // wrapped `navigate`/`recordNavigation`. initNavTracker patches pushState/
  // replaceState so those navigations still record, letting goBack prove a
  // shallower in-app predecessor. See change: fix-plugin-and-scoped-back-navigation.
  describe("history.pushState/replaceState observation", () => {
    it("records raw history.pushState navigations that bypass recordNavigation", () => {
      resetNavStack("/");
      const detach = initNavTracker();
      try {
        window.history.pushState(null, "", "/session/A");
        window.history.pushState(null, "", "/session/A/diff");
        // Board→run analogue: predecessor is the launching route, recorded via
        // the patch (no explicit recordNavigation call).
        expect(predecessor()).toEqual({ url: "/session/A", depth: 1 });
      } finally {
        detach();
        window.history.replaceState(null, "", "/");
      }
    });

    it("replaceState overwrites the stack top instead of appending", () => {
      resetNavStack("/");
      const detach = initNavTracker();
      try {
        window.history.pushState(null, "", "/session/A");
        window.history.replaceState(null, "", "/session/B");
        // top replaced A→B, predecessor still the seed
        expect(predecessor()).toEqual({ url: "/", depth: 0 });
      } finally {
        detach();
        window.history.replaceState(null, "", "/");
      }
    });

    it("detach restores original pushState (no recording after teardown)", () => {
      resetNavStack("/");
      const detach = initNavTracker();
      window.history.pushState(null, "", "/session/A");
      detach();
      window.history.pushState(null, "", "/session/B");
      // after detach, /session/B is not recorded → predecessor still "/"
      expect(predecessor()).toEqual({ url: "/", depth: 0 });
      window.history.replaceState(null, "", "/");
    });
  });

  it("initNavTracker keeps only one popstate listener across repeated calls", () => {
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    try {
      const detach1 = initNavTracker();
      // second init without running detach1 must remove the prior listener
      const detach2 = initNavTracker();
      const popstateAdds = added.mock.calls.filter(([e]) => e === "popstate").length;
      const popstateRemoves = removed.mock.calls.filter(([e]) => e === "popstate").length;
      expect(popstateAdds).toBe(2);
      expect(popstateRemoves).toBe(1); // net one active listener
      detach2();
      detach1(); // stale detach is a no-op (listener already cleared)
      const finalRemoves = removed.mock.calls.filter(([e]) => e === "popstate").length;
      expect(finalRemoves).toBe(2); // exactly one extra remove from detach2
    } finally {
      added.mockRestore();
      removed.mockRestore();
    }
  });
});
