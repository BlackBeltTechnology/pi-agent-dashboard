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
  clearBackground,
  peekBackground,
  resolveBackground,
  splitLocation,
} from "../overlay-background.js";

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
    captureBackground("/folder/xyz/view?path=/a.ts");
    expect(resolveBackground("/settings/general")).toEqual({
      path: "/folder/xyz/view",
      search: "path=/a.ts",
      source: "captured",
    });
  });

  it("never captures the overlay's own location as its background", () => {
    // Guards the obvious self-reference bug: dismissal would be a no-op.
    captureBackground("/settings/general");
    expect(peekBackground()).toBeUndefined();
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
