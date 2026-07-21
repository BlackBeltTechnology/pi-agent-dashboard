/**
 * Tests for the depth-aware mobile back action `goBack`
 * (change: fix-mobile-back-depth-aware), which replaced `goBackOrHome`.
 *
 * Hybrid decision:
 *   - predecessor exists AND its depth < current depth → window.history.back()
 *     fast-path + pop the tracked stack (preserves scroll/forward).
 *   - otherwise → navigate(computeBackTarget(currentRoute)).
 *   - cold load (no predecessor) → navigate(computeBackTarget(currentRoute)).
 *   - depth 0 → no-op.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { goBack } from "../nav/history-back.js";
import type { NavEntry } from "../nav/nav-tracker.js";

function makeTracker(pred: NavEntry | undefined) {
  return {
    predecessor: () => pred,
    popNav: vi.fn(),
  };
}

describe("goBack", () => {
  let originalBack: typeof window.history.back;

  beforeEach(() => {
    originalBack = window.history.back;
  });
  afterEach(() => {
    window.history.back = originalBack;
  });

  it("uses history.back() + popNav when predecessor depth < current depth", () => {
    const back = vi.fn();
    window.history.back = back;
    const navigate = vi.fn();
    const tracker = makeTracker({ url: "/", depth: 0 });

    goBack(navigate, "/session/abc", tracker);

    expect(back).toHaveBeenCalledOnce();
    expect(tracker.popNav).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("depth-navigates when predecessor is NOT shallower (sibling)", () => {
    const back = vi.fn();
    window.history.back = back;
    const navigate = vi.fn();
    const tracker = makeTracker({ url: "/session/A", depth: 1 });

    goBack(navigate, "/session/B", tracker);

    expect(back).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/");
    expect(tracker.popNav).not.toHaveBeenCalled();
  });

  it("cold load (no predecessor) depth-navigates to computed parent", () => {
    const back = vi.fn();
    window.history.back = back;
    const navigate = vi.fn();
    const tracker = makeTracker(undefined);

    goBack(navigate, "/session/abc/diff", tracker);

    expect(back).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/session/abc");
  });

  it("is a no-op at depth 0", () => {
    const back = vi.fn();
    window.history.back = back;
    const navigate = vi.fn();
    const tracker = makeTracker(undefined);

    goBack(navigate, "/", tracker);

    expect(back).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  // Modal carve-out (change: fix-settings-back-to-launching-route): settings /
  // tunnel-setup are same-depth (1) with their launcher, so the shallower-only
  // fast-path can't fire — consult the predecessor directly.
  it("modal route with same-depth predecessor uses history.back() (settings from session)", () => {
    const back = vi.fn();
    window.history.back = back;
    const navigate = vi.fn();
    const tracker = makeTracker({ url: "/session/abc", depth: 1 });

    goBack(navigate, "/settings", tracker);

    expect(back).toHaveBeenCalledOnce();
    expect(tracker.popNav).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("modal subpage (/settings/remote) with predecessor uses history.back()", () => {
    const back = vi.fn();
    window.history.back = back;
    const navigate = vi.fn();
    const tracker = makeTracker({ url: "/session/abc", depth: 1 });

    goBack(navigate, "/settings/remote", tracker);

    expect(back).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("cold-load modal (no predecessor) depth-navigates to / ", () => {
    const back = vi.fn();
    window.history.back = back;
    const navigate = vi.fn();
    const tracker = makeTracker(undefined);

    goBack(navigate, "/settings", tracker);

    expect(back).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/");
    expect(tracker.popNav).not.toHaveBeenCalled();
  });
});
