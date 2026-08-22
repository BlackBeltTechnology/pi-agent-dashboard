/**
 * Pure resolution of the overlay's pinned background location.
 *
 * Covers the D1 (option C) contract: the underlay renders from a path FROZEN at
 * navigation time, never from the current location; a cold load with no capture
 * synthesizes one from `computeBackTarget`.
 *
 * See change: add-route-backed-overlay-dialogs (test-plan S-08, S-08b).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  captureBackground,
  isOverlayRoute,
  recordLauncher,
  resolveDismissTarget,
  clearBackground,
  peekBackground,
  resolveBackground,
  splitLocation,
} from "../overlay-background.js";
import { computeBackTarget, routeDepth } from "../back-target.js";

beforeEach(() => {
  clearBackground();
});

describe("splitLocation", () => {
  it("splits a bare path into path + empty search", () => {
    expect(splitLocation("/session/abc")).toEqual({ path: "/session/abc", search: "" });
  });

  it("splits a path carrying a query string", () => {
    // Three converted routes carry query strings (?path=, ?url=). The underlay
    // must pin BOTH halves, or it reads the current query against a frozen path.
    expect(splitLocation("/folder/xyz/view?path=/a/b.ts")).toEqual({
      path: "/folder/xyz/view",
      search: "path=/a/b.ts",
    });
  });

  it("drops the hash, which is not part of a wouter location", () => {
    expect(splitLocation("/session/abc#frag")).toEqual({ path: "/session/abc", search: "" });
  });

  it("preserves an empty query string as empty, not as '?'", () => {
    expect(splitLocation("/session/abc?")).toEqual({ path: "/session/abc", search: "" });
  });
});

describe("resolveBackground — in-app path (captured)", () => {
  it("returns the captured launching location", () => {
    captureBackground("/session/abc");
    expect(resolveBackground("/settings/general")).toEqual({
      path: "/session/abc",
      search: "",
      source: "captured",
    });
  });

  it("keeps the capture frozen across an in-overlay navigation", () => {
    // S-10: navigating settings → plugin settings must NOT re-capture, or the
    // underlay would follow the overlay and dismissal would land mid-surface.
    captureBackground("/session/abc");
    const first = resolveBackground("/settings/general");
    const second = resolveBackground("/settings/plugins/xyz");
    expect(second).toEqual(first);
    expect(second.path).toBe("/session/abc");
  });

  it("pins the search string of the launching location", () => {
    // Was written against `/folder/xyz/view?path=`, which the url-routing spec
    // lists as a CONVERTED overlay — so it can never be a background, and the
    // old expectation encoded a self-reference the code now refuses. The
    // search-pinning behaviour itself is unchanged; `/session/:id/editor` is a
    // query-carrying route that genuinely stays a full route, so it is the
    // honest example. See change: add-route-backed-overlay-dialogs.
    captureBackground("/session/abc/editor?file=src/a.ts");
    expect(resolveBackground("/settings/general")).toEqual({
      path: "/session/abc/editor",
      search: "file=src/a.ts",
      source: "captured",
    });
  });

  it("never captures the overlay's own location as its background", () => {
    // Guards the obvious self-reference bug: dismissal would be a no-op.
    captureBackground("/settings/general");
    expect(peekBackground()).toBeUndefined();
  });

  // The url-routing spec lists exactly seven converted surfaces. Every one of
  // them must be refused as a background, or it renders behind itself and
  // dismissal becomes a no-op. `isModalRoute` only knows two of them, which is
  // correct for its own job (the mobile back path) but not for this one.
  it.each([
    ["/settings/general"],
    ["/tunnel-setup"],
    ["/folder/Zm9v/settings"],
    ["/folder/Zm9v/settings/skills"],
    ["/folder/Zm9v/view?path=/a.ts"],
    ["/pi-view?url=https://example.com"],
    ["/pi-resource?path=/a.md"],
    ["/folder/Zm9v/openspec/my-change/proposal"],
  ])("refuses the converted overlay route %s as a background", (url) => {
    captureBackground(url);
    expect(peekBackground()).toBeUndefined();
  });

  // The complements matter as much: these are launching routes, and refusing
  // them would leave every overlay opened from them with no background at all.
  it.each([
    ["/"],
    ["/session/abc"],
    ["/folder/Zm9v"],
    ["/folder/Zm9v/editor"],
    ["/folder/Zm9v/openspec"],
    ["/folder/Zm9v/openspec/archive"],
    ["/folder/Zm9v/openspec/specs"],
    ["/session/abc/diff"],
    ["/session/abc/editor"],
  ])("still captures the non-overlay route %s", (url) => {
    captureBackground(url);
    expect(peekBackground()).toBeDefined();
  });
});

// Design D5 requires that dismissing /tunnel-setup returns to /settings/gateway.
// So when an overlay is opened FROM another overlay, the dismissal target is the
// launching overlay -- which is NOT the background, because the background must
// stay a base route for the underlay to have anything to render.
// Task 5.7 states four routes as deliberately NOT converted. A grep proves that
// today and nothing tomorrow; this pins it. If someone later adds one of these
// to the converted set, it stops being a full page AND stops being a usable
// background for the overlay launched from it — two regressions from one edit.
describe("5.7 — routes that stay full pages", () => {
  it.each([
    ["/folder/Zm9v/openspec", "the kanban board needs horizontal width (D6)"],
    ["/session/abc/diff", "read-while-working surface"],
    ["/session/abc/editor", "read-while-working surface"],
  ])("%s is not an overlay route — %s", (url) => {
    expect(isOverlayRoute(url)).toBe(false);
  });

  it("keeps their descriptor depths untouched (5.8: paths must not move)", () => {
    // The ONLY descriptor edit in this change adds `computeParent` to the two
    // folder-settings patterns; every depth is unchanged. A moved depth would
    // silently relocate a back target.
    expect(routeDepth("/folder/Zm9v/openspec")).toBe(2);
    expect(routeDepth("/session/abc/diff")).toBe(2);
    expect(routeDepth("/session/abc/editor")).toBe(2);
    expect(routeDepth("/folder/Zm9v/settings/skills")).toBe(1);
  });

  it("still resolves diff/editor back to their owning session, not to /", () => {
    expect(computeBackTarget("/session/abc/diff")).toBe("/session/abc");
    expect(computeBackTarget("/session/abc/editor")).toBe("/session/abc");
  });
});

describe("resolveDismissTarget — overlay opened from another overlay", () => {
  it("returns the launching overlay, not the base background (D5)", () => {
    captureBackground("/session/abc");
    recordLauncher("/settings/gateway", "/tunnel-setup");
    expect(resolveDismissTarget("/tunnel-setup")).toBe("/settings/gateway");
    // The underlay still renders the base route: settings is not part of the
    // shell content tree, so an underlay pinned to it would render nothing.
    expect(resolveBackground("/tunnel-setup").path).toBe("/session/abc");
  });

  it("carries the launcher's query string", () => {
    recordLauncher("/folder/Zm9v/settings/skills", "/pi-resource?path=/a.md");
    expect(resolveDismissTarget("/pi-resource?path=/a.md")).toBe("/folder/Zm9v/settings/skills");
  });

  it("falls back to the background when the launcher was a base route", () => {
    captureBackground("/session/abc");
    recordLauncher("/session/abc", "/settings/general");
    expect(resolveDismissTarget("/settings/general")).toBe("/session/abc");
  });

  it("ignores an in-surface move so one Esc does not land mid-surface (S-10)", () => {
    captureBackground("/session/abc");
    recordLauncher("/settings/general", "/settings/security");
    expect(resolveDismissTarget("/settings/security")).toBe("/session/abc");
  });

  it("treats a different folder's settings as a different surface", () => {
    captureBackground("/");
    recordLauncher("/folder/Zm9v/settings/skills", "/folder/YmFy/settings/skills");
    expect(resolveDismissTarget("/folder/YmFy/settings/skills")).toBe("/folder/Zm9v/settings/skills");
  });

  it("falls back to the background on a cold load with no launcher", () => {
    captureBackground("/session/abc");
    expect(resolveDismissTarget("/tunnel-setup")).toBe("/session/abc");
  });

  it("never returns the current route, which would make dismissal a no-op", () => {
    recordLauncher("/tunnel-setup", "/tunnel-setup");
    expect(resolveDismissTarget("/tunnel-setup")).toBe("/");
  });
});

describe("resolveBackground — cold load (no capture)", () => {
  it("synthesizes the background from computeBackTarget", () => {
    // S-08b: fresh goto with no predecessor.
    expect(resolveBackground("/settings/security")).toEqual({
      path: "/",
      search: "",
      source: "synthesized",
    });
  });

  it("synthesizes a nested overlay's owning parent, not the card list", () => {
    // The group-2 depth/parentPath declarations are what make this correct;
    // this pins that they now also drive the cold-load underlay.
    const resolved = resolveBackground("/folder/L1VzZXJzL3gvcHJvag/settings/instructions");
    expect(resolved.source).toBe("synthesized");
    expect(resolved.path).toBe("/folder/L1VzZXJzL3gvcHJvag");
  });

  it("falls back to the card list when there is no computable target", () => {
    const resolved = resolveBackground("/definitely-not-a-known-route");
    expect(resolved.path).toBe("/");
    expect(resolved.source).toBe("synthesized");
  });

  it("never returns the overlay's own route as the background", () => {
    // A self-referential underlay would render the overlay behind itself.
    for (const route of ["/settings/general", "/settings/security", "/tunnel-setup"]) {
      expect(resolveBackground(route).path).not.toBe(route);
    }
  });
});

describe("clearBackground", () => {
  it("drops the capture so the next overlay re-captures", () => {
    captureBackground("/session/abc");
    clearBackground();
    expect(peekBackground()).toBeUndefined();
    expect(resolveBackground("/settings/general").source).toBe("synthesized");
  });
});
