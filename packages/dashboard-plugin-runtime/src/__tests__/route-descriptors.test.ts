/**
 * Registry → RouteDescriptor emission for plugin `shell-overlay-route` claims.
 * See change: fix-plugin-and-scoped-back-navigation.
 */
import { describe, it, expect } from "vitest";
// Emitter lives in shared; the runtime re-exports it. Import via the runtime
// barrel to pin the runtime's public surface.
import { claimsToRouteDescriptors } from "../index.js";
import type { ClaimEntry } from "../slot-registry.js";

function claim(over: Partial<ClaimEntry>): ClaimEntry {
  return { pluginId: "p", priority: 100, slot: "shell-overlay-route", ...over } as ClaimEntry;
}

describe("claimsToRouteDescriptors", () => {
  it("emits one descriptor per shell-overlay-route claim that carries a path", () => {
    const d = claimsToRouteDescriptors([
      claim({ path: "/folder/:encodedCwd/automations", depth: 1 }),
      claim({ slot: "settings-section", tab: "general" }), // non-overlay → ignored
      claim({ path: undefined }), // no path → ignored
    ]);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ pattern: "/folder/:encodedCwd/automations", depth: 1 });
    expect(d[0]!.computeParent).toBeUndefined();
  });

  it("defaults a missing depth to 2 (overlay → cards)", () => {
    const [d] = claimsToRouteDescriptors([claim({ path: "/legacy/:id" })]);
    expect(d!.depth).toBe(2);
    expect(d!.computeParent).toBeUndefined();
  });

  it("depth-2 parentPath yields a computeParent that interpolates :params", () => {
    const [d] = claimsToRouteDescriptors([
      claim({
        path: "/folder/:encodedCwd/automations/run/:sid",
        depth: 2,
        parentPath: "/folder/:encodedCwd/automations",
      }),
    ]);
    expect(d!.depth).toBe(2);
    expect(
      d!.computeParent?.({ encodedCwd: "Zm9v", sid: "S" }, "/folder/Zm9v/automations/run/S"),
    ).toBe("/folder/Zm9v/automations");
  });

  it("computeParent degrades to / when a required :param is absent from the match", () => {
    const [d] = claimsToRouteDescriptors([
      // Synthetic: a claim whose parentPath names a :param its own path never
      // captures. `overlay-claims-declare-depth.test.ts` now fails the build on
      // this shape, so no shipped claim should look like this — the runtime
      // safety net is still pinned here. See change: add-route-backed-overlay-dialogs.
      claim({ path: "/legacy/run/:sid", depth: 2, parentPath: "/folder/:encodedCwd/automations" }),
    ]);
    // The match supplies only `sid`, never `encodedCwd`.
    expect(d!.computeParent?.({ sid: "S" }, "/legacy/run/S")).toBe("/");
  });

  it("a depth-1 claim ignores parentPath (no computeParent emitted)", () => {
    const [d] = claimsToRouteDescriptors([
      claim({ path: "/x/:id", depth: 1, parentPath: "/y" }),
    ]);
    expect(d!.computeParent).toBeUndefined();
  });
});
