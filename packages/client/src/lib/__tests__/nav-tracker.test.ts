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
} from "../nav-tracker.js";

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
