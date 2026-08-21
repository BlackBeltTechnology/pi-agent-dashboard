/**
 * Behavioural guard: every real `shell-overlay-route` claim in the generated
 * plugin registry must resolve a back target that returns to its OWNING parent,
 * on both the in-app path and the cold-load path.
 *
 * Why this exists (and why the manifest-scan test was not enough):
 * `overlay-claims-declare-depth.test.ts` asserts a claim *declares* `depth` /
 * `parentPath`. It passed while the Goals and KB claims were declared `depth: 1`
 * — a declaration that made back navigation strictly WORSE than declaring
 * nothing at all:
 *
 *   no depth  → descriptor depth 2 → folder(1) < 2 → fast-path → back to folder ✓
 *   depth: 1  → descriptor depth 1 → folder(1) < 1 is FALSE → computeBackTarget
 *                                  → depth-1 default → "/"                     ✗
 *
 * The fast-path in `history-back.ts` requires a STRICTLY shallower predecessor,
 * so a folder-scoped surface declared at the same depth as its folder loses the
 * fast-path and falls through to the depth default. Declaring `depth` is
 * therefore not the invariant worth testing — resolving to the right parent is.
 *
 * If this test fails: the claim's `depth`/`parentPath` do not return the user to
 * the surface they opened it from. For a surface nested under `/folder/:cwd` or
 * `/session/:id`, declare `depth: 2` plus a `parentPath` naming that parent.
 *
 * See change: add-route-backed-overlay-dialogs.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  claimsToRouteDescriptors,
  type RouteClaimLike,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/route-descriptor.js";
import { PLUGIN_REGISTRY } from "../../../generated/plugin-registry.js";
import { computeBackTarget, registerPluginRouteDescriptors } from "../back-target.js";
import { goBack } from "../history-back.js";
import { popNav, predecessor, recordNavigation, resetNavStack } from "../nav-tracker.js";

const tracker = { predecessor, popNav };

/** Every shell-overlay-route claim across the generated registry. */
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

/**
 * The surface a claim should return to. A claim that declares a `parentPath`
 * owns that answer; otherwise it is the nearest enclosing `/folder/:cwd` or
 * `/session/:id` prefix. Claims nested under neither are out of scope.
 */
function owningParent(claim: RouteClaimLike): string | null {
  if (typeof claim.parentPath === "string" && claim.parentPath.length > 0) {
    return claim.parentPath;
  }
  const segs = (claim.path as string).split("/").filter(Boolean);
  if ((segs[0] === "folder" || segs[0] === "session") && segs.length > 2) {
    return `/${segs[0]}/${segs[1]}`;
  }
  return null;
}

describe("plugin overlay claims return to their owning parent", () => {
  const claims = overlayClaims();
  const nested = claims.filter((c) => typeof c.path === "string" && owningParent(c));

  let originalBack: typeof window.history.back;
  beforeEach(() => {
    originalBack = window.history.back;
    registerPluginRouteDescriptors(claimsToRouteDescriptors(claims));
  });
  afterEach(() => {
    window.history.back = originalBack;
    registerPluginRouteDescriptors([]);
    resetNavStack();
  });

  it("finds the nested claims (guards against a vacuous pass)", () => {
    expect(nested.length).toBeGreaterThanOrEqual(5);
  });

  it.each(nested.map((c) => [c.path as string, owningParent(c) as string]))(
    "cold-load back from %s resolves to its owning parent, not the card list",
    (pattern, parentPattern) => {
      const url = concrete(pattern);
      const parent = concrete(parentPattern);
      resetNavStack(url); // deep link: no in-app predecessor
      expect(computeBackTarget(url)).toBe(parent);
    },
  );

  it.each(nested.map((c) => [c.path as string, owningParent(c) as string]))(
    "in-app back from %s returns to its owning parent, not the card list",
    (pattern, parentPattern) => {
      const url = concrete(pattern);
      const parent = concrete(parentPattern);
      resetNavStack("/");
      recordNavigation(parent);
      recordNavigation(url);
      const back = vi.fn();
      window.history.back = back;
      const navigate = vi.fn();

      goBack(navigate, url, tracker);

      // Either the history fast-path fires (returning to the exact parent URL),
      // or we navigate explicitly to the parent. Landing on "/" is the failure.
      if (back.mock.calls.length > 0) {
        expect(navigate).not.toHaveBeenCalled();
      } else {
        expect(navigate).toHaveBeenCalledWith(parent);
      }
    },
  );
});
