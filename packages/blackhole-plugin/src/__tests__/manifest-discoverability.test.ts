/**
 * L1 — discoverability + ordering + slot-frozen contract for the blackhole
 * session surfaces (test-plan E12, E13; task 4.3).
 *
 *  - the manifest's component/shouldRender/predicate names resolve to real
 *    exports of the client entry (the vite plugin's name-resolver contract)
 *  - the manifest-wide `priority` is strictly HIGHER than flows' (lowest
 *    number wins the one-active `content-view` slot; at the shipped tie of
 *    100 the pluginId tie-break would make blackhole win — E12)
 *  - no claim entry carries a per-claim `priority` field (ignored by design)
 *  - the shared slot DEFINITIONS are unmodified in this change's diff (E13)
 *
 * See change: add-blackhole-session-pipeline.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as clientEntry from "../client/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON = resolve(here, "../../package.json");
const FLOWS_PACKAGE_JSON = resolve(here, "../../../flows-plugin/package.json");

function readManifest(path: string): { priority?: number; claims: Array<Record<string, unknown>> } {
  const pkg = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  return pkg["pi-dashboard-plugin"] as { priority?: number; claims: Array<Record<string, unknown>> };
}

describe("blackhole session-surface manifest discoverability", () => {
  const manifest = readManifest(PACKAGE_JSON);

  it("memory claim's shouldRender names an exported function (gate contract)", () => {
    const claim = manifest.claims.find((c) => c.slot === "session-card-memory");
    expect(claim).toBeDefined();
    const fn = (clientEntry as Record<string, unknown>)[claim!.shouldRender as string];
    expect(typeof fn).toBe("function");
    // Synchronous + fails closed before any resolve (F1).
    expect((fn as () => boolean)()).toBe(false);
  });

  it("content-view claim's component + predicate are exported from the client entry", () => {
    const claim = manifest.claims.find((c) => c.slot === "content-view");
    expect(claim).toBeDefined();
    expect(typeof (clientEntry as Record<string, unknown>)[claim!.component as string]).toBe(
      "function",
    );
    expect(typeof (clientEntry as Record<string, unknown>)[claim!.predicate as string]).toBe(
      "function",
    );
  });

  it("priority is strictly HIGHER than flows' — lowest wins content-view on overlap (E12)", () => {
    const flows = readManifest(FLOWS_PACKAGE_JSON);
    expect(typeof flows.priority).toBe("number");
    expect(manifest.priority!).toBeGreaterThan(flows.priority!);
  });

  it("no claim entry carries a per-claim priority field (E12)", () => {
    for (const claim of manifest.claims) {
      expect(claim, JSON.stringify(claim)).not.toHaveProperty("priority");
    }
  });
});

describe("shared slot definitions are untouched by this change (E13)", () => {
  const FROZEN = [
    "packages/shared/src/dashboard-plugin/slot-types.ts",
    "packages/shared/src/dashboard-plugin/slot-props.ts",
  ];

  it("neither file appears in the change's diff vs origin/develop", (ctx) => {
    // CI checkouts are depth-1 without an origin/develop ref — the scenario
    // cannot be verified there. SKIP with an explicit reason (never a silent
    // green, never a loud red): the dev worktree and local runs enforce it.
    let hasBase = false;
    try {
      execSync("git rev-parse --verify origin/develop", { stdio: "ignore" });
      hasBase = true;
    } catch {
      hasBase = false;
    }
    ctx.skip(!hasBase, "E13 cannot be verified: no origin/develop ref (shallow checkout)");
    // Committed diff (three-dot: the develop merge is not attributed here)…
    const committed = execSync("git diff --name-only origin/develop...HEAD", {
      encoding: "utf-8",
    });
    // …plus everything still uncommitted in the working tree.
    const worktree = execSync("git diff --name-only HEAD", { encoding: "utf-8" });
    const changed = `${committed}\n${worktree}`.split("\n").map((s) => s.trim()).filter(Boolean);
    for (const f of FROZEN) {
      expect(changed, f).not.toContain(f);
    }
  });
});
