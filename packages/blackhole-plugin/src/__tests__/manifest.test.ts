/**
 * L1 — manifest shape and the NO-DEPENDENCY rule (spec: the plugin self-gates on
 * extension presence; plugin declares no dependency on the extension package).
 *
 * `requires.piExtensions` is declared for the Packages-page install prompt only.
 * It is NOT an activation gate — an unsatisfied `requires` leaves the plugin
 * loaded and its claims mounted (design D3), which is exactly why the settings
 * component renders its own not-installed state.
 *
 * See change: add-blackhole-plugin.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../dashboard-plugin-runtime/src/manifest-validator.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const pkgPath = path.resolve(here, "..", "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
const manifest = pkg["pi-dashboard-plugin"] as Record<string, unknown> | undefined;

describe("blackhole-plugin manifest", () => {
  it("has a pi-dashboard-plugin block that validates against the loader", () => {
    expect(manifest).toBeDefined();
    expect(() => validateManifest(manifest, "blackhole")).not.toThrow();
  });

  it("is id `blackhole` with client + server entries", () => {
    const v = validateManifest(manifest, "blackhole");
    expect(v.id).toBe("blackhole");
    expect(v.client).toBeTruthy();
    expect(v.server).toBeTruthy();
  });

  it("declares the settings-section claim on the general tab", () => {
    const v = validateManifest(manifest, "blackhole");
    const claim = v.claims.find((c) => c.slot === "settings-section") as {
      component: string;
      tab?: string;
    };
    expect(claim).toBeDefined();
    expect(claim.component).toBe("BlackholeSettings");
    expect(claim.tab).toBe("general");
  });

  it("lands the deferred session surfaces: session-card-memory + content-view claims", () => {
    // add-blackhole-session-pipeline lands what this manifest previously
    // deferred. The subcard claims the memory slot with the exported
    // synchronous gate; the drill-in claims content-view with an
    // explicit-navigation predicate.
    const v = validateManifest(manifest, "blackhole");
    const slots = v.claims.map((c) => c.slot);
    expect(slots).toContain("session-card-memory");
    expect(slots).toContain("content-view");
    const memory = v.claims.find((c) => c.slot === "session-card-memory") as {
      component: string;
      shouldRender: string;
    };
    expect(memory.component).toBe("MemorySubcard");
    expect(memory.shouldRender).toBe("shouldRenderMemorySubcard");
    const detail = v.claims.find((c) => c.slot === "content-view") as {
      component: string;
      predicate: string;
    };
    expect(detail.component).toBe("PipelineDetailView");
    expect(detail.predicate).toBe("isPipelineDetailActive");
  });

  it("orders manifest-wide with priority 200 — above flows' 100, no per-claim priority (E12)", () => {
    const v = validateManifest(manifest, "blackhole");
    expect(v.priority).toBe(200);
    for (const claim of v.claims) {
      expect(claim, JSON.stringify(claim)).not.toHaveProperty("priority");
    }
  });

  it("names pi-blackhole in requires.piExtensions for the install prompt", () => {
    const v = validateManifest(manifest, "blackhole");
    expect(v.requires?.piExtensions).toEqual(["pi-blackhole"]);
  });
});

describe("no dependency on the pi-blackhole package", () => {
  const sections = ["dependencies", "peerDependencies", "devDependencies", "optionalDependencies"];

  it.each(sections)("%s does not reference pi-blackhole", (section) => {
    const deps = (pkg[section] ?? {}) as Record<string, string>;
    const offending = Object.entries(deps).filter(
      ([name, spec]) => name.includes("pi-blackhole") || spec.includes("pi-blackhole"),
    );
    expect(offending).toEqual([]);
  });
});
