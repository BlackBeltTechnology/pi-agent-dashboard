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

describe("shared slot definitions stay additive (E13)", () => {
  const SLOT_TYPES = "packages/shared/src/dashboard-plugin/slot-types.ts";
  const stripComments = (s: string) => s.replace(/\/\/[^\n]*/g, "");

  /**
   * Parse the `SlotId` union's string-literal members out of slot-types.ts.
   * Strip line comments FIRST: the union carries an inline comment containing a
   * `;`, which would otherwise terminate the lazy `([\s\S]*?);` match after only
   * the first few ids and silently shrink the guard to a subset.
   */
  function slotIds(source: string): Set<string> {
    const union = /type SlotId =([\s\S]*?);/.exec(stripComments(source))?.[1] ?? "";
    return new Set([...union.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  }

  /** Parse `SLOT_DEFINITIONS` → `${multiplicity}/${payloadTier}` per slot id. */
  function slotDefinitions(source: string): Map<string, string> {
    const block =
      /const SLOT_DEFINITIONS[\s\S]*?= \{([\s\S]*?)\n\};/.exec(stripComments(source))?.[1] ?? "";
    const map = new Map<string, string>();
    for (const m of block.matchAll(
      /"([^"]+)":\s*\{\s*multiplicity:\s*"([^"]+)",\s*payloadTier:\s*"([^"]+)"/g,
    )) {
      map.set(m[1], `${m[2]}/${m[3]}`);
    }
    return map;
  }

  /** Resolve origin/develop + working-tree slot-types.ts, or skip on a shallow checkout. */
  function loadSlotTypes(ctx: { skip: (b: boolean, reason: string) => void }) {
    let hasBase = false;
    try {
      execSync("git rev-parse --verify origin/develop", { stdio: "ignore" });
      hasBase = true;
    } catch {
      hasBase = false;
    }
    ctx.skip(!hasBase, "E13 cannot be verified: no origin/develop ref (shallow checkout)");
    return {
      baseSrc: execSync(`git show origin/develop:${SLOT_TYPES}`, { encoding: "utf-8" }),
      headSrc: readFileSync(
        resolve(here, "../../../shared/src/dashboard-plugin/slot-types.ts"),
        "utf-8",
      ),
    };
  }

  // The blackhole change did not modify the frozen slot taxonomy. Since then
  // other changes legitimately ADD slot ids — an additive, minor change (see
  // the `dashboard-shell-slots` spec). The durable invariant E13 guards is
  // therefore "no slot is removed, renamed, or has its multiplicity/tier
  // changed" (a major, breaking change), NOT "the file never appears in a
  // branch diff": the latter red-flags every future additive slot change.
  it("no slot id is removed or renamed vs origin/develop", (ctx) => {
    const { baseSrc, headSrc } = loadSlotTypes(ctx);
    const base = slotIds(baseSrc);
    const head = slotIds(headSrc);
    // Sentinels: the first union member and the LAST one. A parse that
    // truncates (e.g. a future inline comment carrying a `;`) fails loudly here
    // instead of silently covering a subset of the taxonomy.
    expect(base.has("sidebar-folder-section")).toBe(true);
    expect(base.has("rjsf-form")).toBe(true);
    const removed = [...base].filter((id) => !head.has(id));
    expect(removed, `slot id(s) removed or renamed: ${removed.join(", ")}`).toEqual([]);
  });

  it("no slot changes multiplicity/payloadTier vs origin/develop", (ctx) => {
    const { baseSrc, headSrc } = loadSlotTypes(ctx);
    const baseDefs = slotDefinitions(baseSrc);
    const headDefs = slotDefinitions(headSrc);
    // Non-vacuity guard: a regex miss must not pass as "no flips".
    expect(baseDefs.size).toBeGreaterThan(10);
    const flipped = [...baseDefs]
      .filter(([id, def]) => headDefs.get(id) !== def)
      .map(([id]) => id);
    expect(flipped, `slot tier/multiplicity changed: ${flipped.join(", ")}`).toEqual([]);
  });
});
