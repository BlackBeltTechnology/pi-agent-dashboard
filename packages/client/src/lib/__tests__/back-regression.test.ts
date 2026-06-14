/**
 * Regression coverage for the reported mobile-back bug + spec scenarios
 * (change: fix-mobile-back-depth-aware). Exercises the real nav-tracker module
 * end-to-end with the hybrid `goBack` decision.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { goBack } from "../history-back.js";
import {
  resetNavStack,
  recordNavigation,
  predecessor,
  popNav,
} from "../nav-tracker.js";

const tracker = { predecessor, popNav };

describe("mobile back — regression", () => {
  let originalBack: typeof window.history.back;
  beforeEach(() => {
    resetNavStack();
    originalBack = window.history.back;
  });
  afterEach(() => {
    window.history.back = originalBack;
  });

  // Spec: "Back from chat returns to cards regardless of prior chats"
  it("/ → /session/A → /session/B, back → / (never /session/A)", () => {
    resetNavStack("/");
    recordNavigation("/session/A");
    recordNavigation("/session/B");
    const navigate = vi.fn();

    goBack(navigate, "/session/B", tracker);

    expect(navigate).toHaveBeenCalledWith("/");
    expect(navigate).not.toHaveBeenCalledWith("/session/A");
  });

  // Spec: "Back from a depth-2 overlay returns one depth up, not to a sibling overlay"
  it("chained sibling overlays, back → one depth up, never the sibling", () => {
    resetNavStack("/");
    recordNavigation("/session/abc");
    recordNavigation("/folder/Zm9v/openspec/my-change/proposal");
    recordNavigation("/folder/Zm9v/openspec/archive");
    const navigate = vi.fn();

    goBack(navigate, "/folder/Zm9v/openspec/archive", tracker);

    // predecessor is the sibling overlay (same depth) → depth-navigate to cards
    expect(navigate).toHaveBeenCalledWith("/");
    expect(navigate).not.toHaveBeenCalledWith(
      "/folder/Zm9v/openspec/my-change/proposal",
    );
  });

  it("single overlay launched from a session → fast-path back to the session", () => {
    resetNavStack("/");
    recordNavigation("/session/abc");
    recordNavigation("/folder/Zm9v/openspec/my-change/proposal");
    const back = vi.fn();
    window.history.back = back;
    const navigate = vi.fn();

    goBack(navigate, "/folder/Zm9v/openspec/my-change/proposal", tracker);

    // predecessor /session/abc (depth 1) < current depth 2 → history.back()
    expect(back).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });

  // Spec: "history.back() fast-path used when predecessor is a shallower in-app route"
  it("/settings → openspec overlay, back uses window.history.back()", () => {
    resetNavStack("/");
    recordNavigation("/settings");
    recordNavigation("/folder/Zm9v/openspec/my-change/proposal");
    const back = vi.fn();
    window.history.back = back;
    const navigate = vi.fn();

    goBack(
      navigate,
      "/folder/Zm9v/openspec/my-change/proposal",
      tracker,
    );

    expect(back).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });
});
