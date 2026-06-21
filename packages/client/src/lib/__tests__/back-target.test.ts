/**
 * Tests for computeBackTarget — pure route → parent-route resolver used by the
 * depth-aware mobile back action (change: fix-mobile-back-depth-aware).
 *
 * Maps the active route to exactly one shell depth shallower:
 *   - depth 1 (session / folder detail / settings / tunnel) → "/"
 *   - depth 2 /session/:id/diff → /session/:id (URL-computable parent)
 *   - depth 2 ambiguous overlays (openspec/pi-resources/pi-resource/view) → "/"
 *   - depth 0 ("/") → null (no-op)
 */
import { describe, it, expect } from "vitest";
import { computeBackTarget, routeDepth, isModalRoute } from "../back-target.js";

describe("computeBackTarget", () => {
  it("returns null at depth 0 (cards)", () => {
    expect(computeBackTarget("/")).toBeNull();
  });

  describe("depth 1 → /", () => {
    const depth1 = [
      "/session/abc",
      "/session/abc?tab=foo",
      "/folder/Zm9v/terminals",
      "/folder/Zm9v/editor",
      "/settings",
      "/settings/remote",
      "/settings?tab=servers",
      "/tunnel-setup",
    ];
    for (const route of depth1) {
      it(`${route} → /`, () => {
        expect(routeDepth(route)).toBe(1);
        expect(computeBackTarget(route)).toBe("/");
      });
    }
  });

  describe("depth 2 → parent", () => {
    it("/session/:id/diff strips /diff → /session/:id", () => {
      expect(routeDepth("/session/abc/diff")).toBe(2);
      expect(computeBackTarget("/session/abc/diff")).toBe("/session/abc");
    });

    const ambiguous = [
      "/folder/Zm9v/openspec/my-change/proposal",
      "/folder/Zm9v/openspec/archive",
      "/folder/Zm9v/openspec/specs",
      "/folder/Zm9v/pi-resources",
      "/folder/Zm9v/view?path=%2Ftmp%2Fa.txt",
      "/pi-view?url=https%3A%2F%2Fexample.com",
      "/pi-resource?path=%2Ftmp%2Fskill.md",
    ];
    for (const route of ambiguous) {
      it(`${route} → /`, () => {
        expect(routeDepth(route)).toBe(2);
        expect(computeBackTarget(route)).toBe("/");
      });
    }
  });
});

describe("isModalRoute", () => {
  const modal = ["/settings", "/settings/general", "/settings/remote", "/settings?tab=servers", "/tunnel-setup"];
  for (const url of modal) {
    it(`${url} → true`, () => {
      expect(isModalRoute(url)).toBe(true);
    });
  }

  const lateral = ["/", "/session/abc", "/session/abc/diff", "/folder/Zm9v/terminals", "/folder/Zm9v/editor", "/folder/Zm9v/openspec/archive", "/pi-view?url=x"];
  for (const url of lateral) {
    it(`${url} → false`, () => {
      expect(isModalRoute(url)).toBe(false);
    });
  }
});
