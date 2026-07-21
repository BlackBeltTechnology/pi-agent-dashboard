/**
 * Regression coverage for the reported mobile-back bug + spec scenarios
 * (change: fix-mobile-back-depth-aware). Exercises the real nav-tracker module
 * end-to-end with the hybrid `goBack` decision.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  interpolateParentPath,
  type RouteDescriptor,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/route-descriptor.js";
import { goBack } from "../nav/history-back.js";
import { registerPluginRouteDescriptors } from "../nav/back-target.js";
import {
  resetNavStack,
  recordNavigation,
  predecessor,
  popNav,
  initNavTracker,
} from "../nav/nav-tracker.js";

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

  // Reported bug (change: fix-settings-back-to-launching-route): Settings opened
  // from a session is same-depth (1) with it, so the shallower-only fast-path
  // can't fire; the modal carve-out must return to the launching session.
  it("/ → /session/abc → /settings, back → /session/abc (modal carve-out)", () => {
    resetNavStack("/");
    recordNavigation("/session/abc");
    recordNavigation("/settings");
    const back = vi.fn();
    window.history.back = back;
    const navigate = vi.fn();

    goBack(navigate, "/settings", tracker);

    // predecessor /session/abc (same depth 1) → modal carve-out → history.back()
    expect(back).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("cold-load /settings (no predecessor), back → / ", () => {
    resetNavStack("/settings");
    const back = vi.fn();
    window.history.back = back;
    const navigate = vi.fn();

    goBack(navigate, "/settings", tracker);

    // no in-app predecessor → computeBackTarget → "/"
    expect(back).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/");
  });
});

// Plugin overlay routes (Automations) — depth resolved from the registry-fed
// descriptor table so back is no longer a dead no-op.
// See change: fix-plugin-and-scoped-back-navigation.
describe("plugin overlay back — automations", () => {
  const automationDescriptors: RouteDescriptor[] = [
    { pattern: "/folder/:encodedCwd/automations", depth: 1 },
    {
      pattern: "/automation/run/:sid",
      depth: 2,
      computeParent: (p) => interpolateParentPath("/folder/:encodedCwd/automations", p) ?? "/",
    },
  ];
  let originalBack: typeof window.history.back;
  beforeEach(() => {
    resetNavStack();
    registerPluginRouteDescriptors(automationDescriptors);
    originalBack = window.history.back;
  });
  afterEach(() => {
    window.history.back = originalBack;
    registerPluginRouteDescriptors([]);
  });

  it("cold-load board back → cards via computeBackTarget (was a dead no-op)", () => {
    resetNavStack("/folder/Zm9v/automations"); // deep-link, no predecessor
    const back = vi.fn();
    window.history.back = back;
    const navigate = vi.fn();

    goBack(navigate, "/folder/Zm9v/automations", tracker);

    // depth 1 (not 0) → no longer early-returns; navigates to cards.
    expect(navigate).toHaveBeenCalledWith("/");
    expect(back).not.toHaveBeenCalled();
  });

  it("board back with a shallower predecessor uses history.back() (returns to cards)", () => {
    resetNavStack("/");
    recordNavigation("/folder/Zm9v/automations");
    const back = vi.fn();
    window.history.back = back;
    const navigate = vi.fn();

    goBack(navigate, "/folder/Zm9v/automations", tracker);

    // predecessor "/" (depth 0) < board depth 1 → fast-path.
    expect(back).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("run monitor (depth 2) opened from the board → back returns to the board via the tracker", () => {
    resetNavStack("/");
    recordNavigation("/folder/Zm9v/automations"); // board, depth 1
    recordNavigation("/automation/run/S"); // run, depth 2
    const back = vi.fn();
    window.history.back = back;
    const navigate = vi.fn();

    goBack(navigate, "/automation/run/S", tracker);

    // board depth 1 < run depth 2 → history.back() returns to the exact board
    // URL (with its cwd), which computeBackTarget cannot reconstruct alone.
    expect(back).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });

  // End-to-end: the run monitor is reached by wouter's raw `useLocation`
  // (history.pushState), NOT App's wrapped navigate — so before the tracker
  // observed pushState the launching route was never recorded and back fell to
  // computeParent → "/" (the reported "goes home" bug). With the pushState
  // patch the launching session is recorded and back history-walks to it.
  // See change: fix-plugin-and-scoped-back-navigation.
  it("run monitor opened via RAW pushState from a session → back returns to that session", () => {
    resetNavStack("/");
    const detach = initNavTracker();
    const back = vi.fn();
    window.history.back = back;
    const navigate = vi.fn();
    try {
      // Simulate the real plugin/session-card path: raw pushState, no
      // recordNavigation call.
      window.history.pushState(null, "", "/session/abc"); // launching session (depth 1)
      window.history.pushState(null, "", "/automation/run/S"); // run monitor (depth 2)

      goBack(navigate, "/automation/run/S", tracker);

      // predecessor /session/abc (depth 1) < run depth 2 → history.back() →
      // the launching session, not "/".
      expect(back).toHaveBeenCalledOnce();
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      detach();
      window.history.replaceState(null, "", "/");
    }
  });
});
