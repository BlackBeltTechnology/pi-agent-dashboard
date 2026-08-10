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
import { afterEach, describe, expect, it } from "vitest";
import {
  interpolateParentPath,
  type RouteDescriptor,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/route-descriptor.js";
import {
  computeBackTarget,
  isModalRoute,
  registerPluginRouteDescriptors,
  routeDepth,
} from "../nav/back-target.js";

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
      "/folder/Zm9v/settings",
      "/folder/Zm9v/settings/packages",
      "/folder/Zm9v/settings/resources",
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

    // Internal Monaco editor pane (change: add-internal-monaco-editor-pane),
    // opened from a file-read preview's "Open" button. Was missing from the
    // classifier → depth 0 → dead back button. See change:
    // fix-plugin-and-scoped-back-navigation.
    it("/session/:id/editor strips /editor → /session/:id (with ?file=)", () => {
      expect(routeDepth("/session/abc/editor")).toBe(2);
      expect(computeBackTarget("/session/abc/editor")).toBe("/session/abc");
      expect(computeBackTarget("/session/abc/editor?file=AGENTS.md")).toBe("/session/abc");
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

// Registry-fed plugin descriptors — the Automations board + run monitor were
// depth-0 dead no-ops before the classifier learned plugin routes.
// See change: fix-plugin-and-scoped-back-navigation.
describe("plugin route descriptors (registry-fed)", () => {
  // Mirrors what `claimsToRouteDescriptors` emits for the automation manifest
  // (that emission is unit-tested in dashboard-plugin-runtime); here we pin the
  // classifier's resolution of registered plugin descriptors.
  const automationDescriptors: RouteDescriptor[] = [
    { pattern: "/folder/:encodedCwd/automations", depth: 1 },
    {
      pattern: "/automation/run/:sid",
      depth: 2,
      computeParent: (p) => interpolateParentPath("/folder/:encodedCwd/automations", p) ?? "/",
    },
  ];

  afterEach(() => registerPluginRouteDescriptors([]));

  it("without descriptors, a plugin route is depth 0 (the reported dead no-op)", () => {
    registerPluginRouteDescriptors([]);
    expect(routeDepth("/folder/Zm9v/automations")).toBe(0);
    expect(computeBackTarget("/folder/Zm9v/automations")).toBeNull();
  });

  it("board resolves depth 1 → / via the registry-fed table", () => {
    registerPluginRouteDescriptors(automationDescriptors);
    expect(routeDepth("/folder/Zm9v/automations")).toBe(1);
    expect(computeBackTarget("/folder/Zm9v/automations")).toBe("/");
  });

  it("run monitor resolves depth 2; cold-load parent degrades to / (cwd not in URL)", () => {
    registerPluginRouteDescriptors(automationDescriptors);
    expect(routeDepth("/automation/run/S")).toBe(2);
    // The run URL carries no cwd, so a cold-load back degrades to cards; the
    // run→board walk is guaranteed by the nav-tracker fast-path instead.
    expect(computeBackTarget("/automation/run/S")).toBe("/");
  });

  it("a depth-2 plugin descriptor with no computeParent backs to / (legacy default)", () => {
    registerPluginRouteDescriptors([{ pattern: "/legacy/:id", depth: 2 }]);
    expect(routeDepth("/legacy/abc")).toBe(2);
    expect(computeBackTarget("/legacy/abc")).toBe("/");
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
