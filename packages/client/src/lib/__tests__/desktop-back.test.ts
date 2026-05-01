/**
 * Tests for the pure desktop back-arrow priority helper.
 *
 * The helper is a single source of truth for "what does back mean in the
 * desktop content area?" — the calling hook + App.tsx wiring must match
 * mobile's inline `onBack` switch, so we also include a parity test that
 * cycles through every 2^8 boolean combination of overlay flags.
 *
 * See change: fix-desktop-back-navigation.
 */
import { describe, it, expect } from "vitest";
import {
  selectDesktopBackTarget,
  type BackInputState,
  type BackTarget,
  type BackTargetKey,
} from "../desktop-back.js";

const ALL_FALSE: BackInputState = {
  archiveBrowserCwd: false,
  specsBrowserCwd: false,
  flowYamlPreview: false,
  diffViewSessionId: false,
  piResourceFilePreview: false,
  readmePreview: false,
  piResourcesState: false,
  previewState: false,
  selectedId: false,
};

describe("selectDesktopBackTarget", () => {
  describe("each overlay in isolation", () => {
    const cases: Array<[keyof BackInputState, BackTargetKey]> = [
      ["archiveBrowserCwd", "archive"],
      ["specsBrowserCwd", "specs"],
      ["flowYamlPreview", "flowYaml"],
      ["diffViewSessionId", "diff"],
      ["piResourceFilePreview", "piResourceFile"],
      ["readmePreview", "readme"],
      ["piResourcesState", "piResources"],
      ["previewState", "preview"],
    ];
    for (const [flag, target] of cases) {
      it(`${flag} → clear "${target}"`, () => {
        const result = selectDesktopBackTarget({ ...ALL_FALSE, [flag]: true });
        expect(result).toEqual({ kind: "clear", target });
      });
    }
  });

  describe("priority order", () => {
    it("archive wins over specs", () => {
      const r = selectDesktopBackTarget({
        ...ALL_FALSE,
        archiveBrowserCwd: true,
        specsBrowserCwd: true,
      });
      expect(r).toEqual({ kind: "clear", target: "archive" });
    });

    it("specs wins over flowYaml", () => {
      const r = selectDesktopBackTarget({
        ...ALL_FALSE,
        specsBrowserCwd: true,
        flowYamlPreview: true,
      });
      expect(r).toEqual({ kind: "clear", target: "specs" });
    });

    it("preview is the lowest priority overlay", () => {
      const r = selectDesktopBackTarget({
        ...ALL_FALSE,
        previewState: true,
        // higher-priority overlay also set
        piResourcesState: true,
      });
      expect(r).toEqual({ kind: "clear", target: "piResources" });
    });

    it("first hit in PRIORITY_CHAIN wins, regardless of how many are set", () => {
      const allOverlays: BackInputState = {
        ...ALL_FALSE,
        archiveBrowserCwd: true,
        specsBrowserCwd: true,
        flowYamlPreview: true,
        diffViewSessionId: true,
        piResourceFilePreview: true,
        readmePreview: true,
        piResourcesState: true,
        previewState: true,
      };
      const r = selectDesktopBackTarget(allOverlays);
      expect(r).toEqual({ kind: "clear", target: "archive" });
    });
  });

  describe("navigate fallback", () => {
    it("returns navigate to / when no overlays set", () => {
      const r = selectDesktopBackTarget(ALL_FALSE);
      expect(r).toEqual({ kind: "navigate", to: "/" });
    });

    it("returns navigate to / even when selectedId is true (cold-load fix)", () => {
      const r = selectDesktopBackTarget({ ...ALL_FALSE, selectedId: true });
      expect(r).toEqual({ kind: "navigate", to: "/" });
    });
  });

  describe("parity with mobile inline switch", () => {
    /**
     * Reference implementation that mirrors mobile's inline switch in
     * `App.tsx:1370–1390`. Exists only as a test fixture so we can compare
     * the helper against it across all 256 boolean combinations of overlay
     * flags. If they ever drift, the test fails.
     */
    function mobileInlineSelect(state: BackInputState): BackTarget {
      if (state.archiveBrowserCwd) return { kind: "clear", target: "archive" };
      if (state.specsBrowserCwd) return { kind: "clear", target: "specs" };
      if (state.flowYamlPreview) return { kind: "clear", target: "flowYaml" };
      if (state.diffViewSessionId) return { kind: "clear", target: "diff" };
      if (state.piResourceFilePreview) return { kind: "clear", target: "piResourceFile" };
      if (state.readmePreview) return { kind: "clear", target: "readme" };
      if (state.piResourcesState) return { kind: "clear", target: "piResources" };
      if (state.previewState) return { kind: "clear", target: "preview" };
      return { kind: "navigate", to: "/" };
    }

    it("agrees with mobile inline switch across all 256 boolean combinations", () => {
      const flags: Array<keyof BackInputState> = [
        "archiveBrowserCwd",
        "specsBrowserCwd",
        "flowYamlPreview",
        "diffViewSessionId",
        "piResourceFilePreview",
        "readmePreview",
        "piResourcesState",
        "previewState",
      ];
      for (let bits = 0; bits < 1 << flags.length; bits++) {
        const state: BackInputState = { ...ALL_FALSE };
        for (let b = 0; b < flags.length; b++) {
          if (bits & (1 << b)) (state as any)[flags[b]] = true;
        }
        const helperResult = selectDesktopBackTarget(state);
        const mobileResult = mobileInlineSelect(state);
        expect(helperResult).toEqual(mobileResult);
      }
    });
  });

  describe("purity", () => {
    it("does not mutate the input state", () => {
      const state: BackInputState = { ...ALL_FALSE, previewState: true };
      const before = { ...state };
      selectDesktopBackTarget(state);
      expect(state).toEqual(before);
    });
  });
});
