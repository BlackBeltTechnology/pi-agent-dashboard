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
    {
      pattern: "/folder/:encodedCwd/automations",
      depth: 2,
      computeParent: (p) => interpolateParentPath("/folder/:encodedCwd", p) ?? "/",
    },
    {
      pattern: "/folder/:encodedCwd/automations/run/:sid",
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

  it("cold-load board back → its owning folder via computeBackTarget", () => {
    resetNavStack("/folder/Zm9v/automations"); // deep-link, no predecessor
    const back = vi.fn();
    window.history.back = back;
    const navigate = vi.fn();

    goBack(navigate, "/folder/Zm9v/automations", tracker);

    // Was `navigate("/")` while the board was declared depth 1. A folder-scoped
    // board is depth 2 with a parentPath, so a cold-loaded back reconstructs the
    // folder instead of ejecting to the card list.
    // See change: add-route-backed-overlay-dialogs.
    expect(navigate).toHaveBeenCalledWith("/folder/Zm9v");
    expect(back).not.toHaveBeenCalled();
  });

  it("board back with a shallower predecessor uses history.back()", () => {
    resetNavStack("/");
    recordNavigation("/folder/Zm9v/automations");
    const back = vi.fn();
    window.history.back = back;
    const navigate = vi.fn();

    goBack(navigate, "/folder/Zm9v/automations", tracker);

    // predecessor "/" (depth 0) < board depth 2 → fast-path.
    expect(back).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("run monitor opened from the board → back returns to the board via computeParent", () => {
    resetNavStack("/");
    recordNavigation("/folder/Zm9v/automations"); // board, depth 2
    recordNavigation("/folder/Zm9v/automations/run/S"); // run, depth 2
    const back = vi.fn();
    window.history.back = back;
    const navigate = vi.fn();

    goBack(navigate, "/folder/Zm9v/automations/run/S", tracker);

    // KNOWN LIMITATION: `depth` is `1 | 2` only, so a three-level hierarchy
    // (folder → board → run) cannot be strictly increasing — board and run are
    // both depth 2. `pred.depth < currentDepth` is therefore false and the
    // history fast-path does NOT fire; the back resolves through the run's
    // declared `parentPath` instead. The user still lands on the board, but via
    // an explicit navigation, so scroll position and the forward entry are not
    // preserved. Accepted: correct destination beats preserved scroll.
    // See change: add-route-backed-overlay-dialogs.
    expect(navigate).toHaveBeenCalledWith("/folder/Zm9v/automations");
    expect(back).not.toHaveBeenCalled();
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
      window.history.pushState(null, "", "/folder/Zm9v/automations/run/S"); // run monitor (depth 2)

      goBack(navigate, "/folder/Zm9v/automations/run/S", tracker);

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
