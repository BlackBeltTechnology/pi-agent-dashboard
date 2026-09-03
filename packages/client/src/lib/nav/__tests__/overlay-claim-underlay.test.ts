/**
 * Task 4.4, second half: the SAME group-2 depth declarations that drive the
 * depth-aware back action now ALSO feed the cold-load underlay (3.1b).
 *
 * The first half — "the mobile path still walks the depth table" — is already
 * covered by `overlay-claim-back-targets.test.ts`, which drives the real
 * `goBack` over every registry claim. This file deliberately does not repeat
 * that; it pins the property that makes option C cheap:
 *
 *   one declaration  →  back target        (fix-plugin-and-scoped-back-navigation)
 *                    →  cold-load underlay (add-route-backed-overlay-dialogs)
 *
 * If these two ever diverge, a cold-loaded plugin overlay would dismiss to one
 * surface while showing a different one behind its scrim.
 *
 * See change: add-route-backed-overlay-dialogs.
 */
import {
  claimsToRouteDescriptors,
  type RouteClaimLike,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/route-descriptor.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLUGIN_REGISTRY } from "../../../generated/plugin-registry.js";
import { computeBackTarget, registerPluginRouteDescriptors } from "../back-target.js";
import { clearBackground, resolveBackground } from "../overlay-background.js";

function overlayClaims(): RouteClaimLike[] {
  const out: RouteClaimLike[] = [];
  for (const entry of PLUGIN_REGISTRY) {
    for (const claim of entry.claims) {
      if (claim.slot === "shell-overlay-route") out.push(claim as unknown as RouteClaimLike);
    }
  }
  return out;
}

/** Substitute a concrete value for every `:param` so the pattern becomes a URL. */
function concrete(pattern: string): string {
  return pattern
    .split("/")
    .map((seg) => (seg.startsWith(":") ? (seg === ":encodedCwd" ? "Zm9v" : "X") : seg))
    .join("/");
}

const claims = overlayClaims();
const routes = claims
  .map((c) => c.path)
  .filter((p): p is string => typeof p === "string")
  .map(concrete);

describe("plugin overlay claims feed the cold-load underlay", () => {
  beforeEach(() => {
    // No captured background — this is the cold-load path by construction.
    clearBackground();
    registerPluginRouteDescriptors(claimsToRouteDescriptors(claims));
  });
  afterEach(() => {
    registerPluginRouteDescriptors([]);
    clearBackground();
  });

  it("finds the claims (guards against a vacuous pass)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(5);
  });

  it.each(routes)("cold-load underlay for %s is synthesized, not empty", (route) => {
    const bg = resolveBackground(route);
    expect(bg.source).toBe("synthesized");
    expect(bg.path).not.toBe(route);
  });

  it.each(routes)("underlay for %s matches its own back target", (route) => {
    // The invariant: dismissal target and underlay come from ONE declaration.
    expect(resolveBackground(route).path).toBe(computeBackTarget(route));
  });

  it.each(routes)("underlay for %s is not the card list", (route) => {
    // Degrading to "/" is exactly the defect group 2 fixed for the back action;
    // it must not reappear on the underlay path.
    expect(resolveBackground(route).path).not.toBe("/");
  });
});

describe("without the plugin declarations the underlay degrades", () => {
  beforeEach(() => {
    clearBackground();
    registerPluginRouteDescriptors([]);
  });
  afterEach(clearBackground);

  it.each(routes)("%s falls back to the card list when descriptors are absent", (route) => {
    // Fails-closed proof that the assertions above are actually reading the
    // plugin declarations rather than some unrelated static descriptor.
    expect(resolveBackground(route).path).toBe("/");
  });
});
