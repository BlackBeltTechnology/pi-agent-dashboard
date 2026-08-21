/**
 * Repo-level invariant: every `shell-overlay-route` claim in a bundled plugin
 * MUST declare `depth`, and every `depth: 2` claim MUST declare a `parentPath`
 * whose `:params` are all suppliable by its own path match.
 *
 * Why: `manifest-validator.ts` only `console.warn`s on a missing `depth`, and
 * `claimsToRouteDescriptors` then defaults it to `2` with no `parentPath` — so
 * the back target silently degrades to `/`. An operator who opens Goals or the
 * KB from a folder and presses back is ejected to the card list and loses the
 * folder entirely. Four claims shipped in that state (goal ×2, kb, subagents)
 * because a non-fatal warning is invisible in practice.
 *
 * The `parentPath` param check catches the subtler half: `interpolateParentPath`
 * returns `null` — degrading to `/` — when the parent pattern names a `:param`
 * the child's own path never captures. A `parentPath` can therefore be present,
 * well-formed, and still dead. `/automation/run/:sid` → `/folder/:encodedCwd/
 * automations` was exactly that shape — it captured `sid`, never `encodedCwd` —
 * and was re-parented to `/folder/:encodedCwd/automations/run/:sid` so the cwd
 * the parent needs is carried by the child.
 *
 * If this test fails: declare `depth` (1 = detail, 2 = overlay-on-detail) on the
 * claim, and for `depth: 2` a `parentPath` built only from `:params` the claim's
 * own `path` captures.
 *
 * See change: add-route-backed-overlay-dialogs.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");

interface OverlayClaim {
  pluginId: string;
  dir: string;
  index: number;
  path?: unknown;
  depth?: unknown;
  parentPath?: unknown;
}

/** Collect every `shell-overlay-route` claim across non-fixture bundled plugins. */
function collectOverlayClaims(): OverlayClaim[] {
  const out: OverlayClaim[] = [];
  for (const dir of fs.readdirSync(PACKAGES_DIR)) {
    const pkgPath = path.join(PACKAGES_DIR, dir, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    const manifest = pkg["pi-dashboard-plugin"] as
      | { id?: string; fixture?: boolean; claims?: Record<string, unknown>[] }
      | undefined;
    if (!manifest || manifest.fixture === true) continue;
    const claims = manifest.claims ?? [];
    claims.forEach((claim, index) => {
      if (claim.slot !== "shell-overlay-route") return;
      out.push({
        pluginId: manifest.id ?? dir,
        dir,
        index,
        path: claim.path,
        depth: claim.depth,
        parentPath: claim.parentPath,
      });
    });
  }
  return out;
}

/** `:param` names captured by a wouter-style path pattern. */
function capturedParams(pattern: string): Set<string> {
  return new Set(
    pattern
      .split("/")
      .filter((seg) => seg.startsWith(":"))
      .map((seg) => seg.slice(1)),
  );
}

/** `:param` names a parent pattern requires. */
function requiredParams(pattern: string): string[] {
  return pattern
    .split("/")
    .filter((seg) => seg.startsWith(":"))
    .map((seg) => seg.slice(1));
}

describe("shell-overlay-route claims declare back-navigation intent", () => {
  const claims = collectOverlayClaims();

  it("finds the bundled overlay claims (guards against a vacuous pass)", () => {
    // A scan bug that returns [] would make every test below trivially green.
    expect(claims.length).toBeGreaterThanOrEqual(6);
  });

  it("every claim declares an explicit depth of 1 or 2", () => {
    const undeclared = claims
      .filter((c) => c.depth !== 1 && c.depth !== 2)
      .map((c) => `${c.pluginId} claims[${c.index}] path=${String(c.path)} depth=${String(c.depth)}`);
    expect(undeclared, `claims missing an explicit depth:\n${undeclared.join("\n")}`).toEqual([]);
  });

  it("every depth-2 claim declares a parentPath", () => {
    const missing = claims
      .filter((c) => c.depth === 2 && typeof c.parentPath !== "string")
      .map((c) => `${c.pluginId} claims[${c.index}] path=${String(c.path)}`);
    expect(
      missing,
      `depth-2 claims without a parentPath back to "/" and lose their parent:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("every parentPath is interpolable from the claim's own captured params", () => {
    const dead: string[] = [];
    for (const claim of claims) {
      if (typeof claim.parentPath !== "string" || typeof claim.path !== "string") continue;
      const captured = capturedParams(claim.path);
      const unsatisfiable = requiredParams(claim.parentPath).filter((p) => !captured.has(p));
      if (unsatisfiable.length > 0) {
        dead.push(
          `${claim.pluginId} claims[${claim.index}] ${claim.path} → ${claim.parentPath} ` +
            `(cannot supply :${unsatisfiable.join(", :")})`,
        );
      }
    }
    expect(
      dead,
      `parentPath present but unreachable — interpolateParentPath returns null and back degrades to "/":\n${dead.join("\n")}`,
    ).toEqual([]);
  });
});
