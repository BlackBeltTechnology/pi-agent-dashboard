/**
 * Repository gate: every BUNDLED plugin's `shell-overlay-route` claims declare a
 * reachable back target.
 *
 * Deliberately NOT enforced in `validateManifest`. The claim contract keeps
 * `depth` and `parentPath` optional with a runtime degradation to `/`, and the
 * spec is explicit that the degradation "remains a safety net for third-party
 * manifests" — making it fatal there would break third-party plugins that load
 * today with a warning. First-party plugins may not lean on that safety net, so
 * the gate is a build-time scan over the manifests we ship.
 *
 * See change: add-route-backed-overlay-dialogs (task 4.6), spec
 * "Overlay claims SHALL declare a reachable back target".
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGES_DIR = join(__dirname, "../../..");

interface OverlayClaim {
  slot?: string;
  path?: string;
  depth?: unknown;
  parentPath?: string;
  presentation?: string;
  config?: { path?: string };
}

interface ScannedClaim {
  pluginId: string;
  index: number;
  claim: OverlayClaim;
  path: string;
}

/** `:param` tokens a wouter pattern captures. */
function paramsOf(pattern: string): Set<string> {
  return new Set(
    pattern
      .split("/")
      .filter((seg) => seg.startsWith(":"))
      .map((seg) => seg.slice(1).replace(/\?$/, "")),
  );
}

function scanBundledOverlayClaims(): ScannedClaim[] {
  const found: ScannedClaim[] = [];
  for (const pkg of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    let raw: string;
    try {
      raw = readFileSync(join(PACKAGES_DIR, pkg.name, "package.json"), "utf8");
    } catch {
      continue;
    }
    let parsed: { name?: string; "pi-dashboard-plugin"?: { id?: string; claims?: OverlayClaim[] } };
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const manifest = parsed["pi-dashboard-plugin"];
    if (!manifest?.claims) continue;
    manifest.claims.forEach((claim, index) => {
      if (claim.slot !== "shell-overlay-route") return;
      const path = claim.path ?? claim.config?.path;
      if (typeof path !== "string") return;
      found.push({ pluginId: manifest.id ?? parsed.name ?? pkg.name, index, claim, path });
    });
  }
  return found;
}

const claims = scanBundledOverlayClaims();

function label(c: ScannedClaim) {
  return `${c.pluginId} claims[${c.index}] ${c.path}`;
}

describe("bundled shell-overlay-route claims", () => {
  it("finds a non-trivial number of claims", () => {
    // Non-vacuity guard the spec requires: a discovery bug that returns an
    // empty list must fail here rather than make every assertion below
    // trivially green.
    expect(claims.length).toBeGreaterThanOrEqual(5);
  });

  it("every claim declares an explicit depth", () => {
    const offenders = claims.filter((c) => c.claim.depth !== 1 && c.claim.depth !== 2);
    expect(offenders.map(label)).toEqual([]);
  });

  it("every depth-2 claim declares a parentPath", () => {
    const offenders = claims.filter(
      (c) => c.claim.depth === 2 && typeof c.claim.parentPath !== "string",
    );
    expect(offenders.map(label)).toEqual([]);
  });

  it("every parentPath is interpolable from its own path's params", () => {
    // interpolateParentPath returns null — degrading the back target to `/` —
    // when the parent names a :param the child never captures. A parentPath can
    // be present, well-formed, and still dead.
    const offenders = claims
      .filter((c) => typeof c.claim.parentPath === "string")
      .map((c) => {
        const own = paramsOf(c.path);
        const missing = [...paramsOf(c.claim.parentPath as string)].filter((p) => !own.has(p));
        return missing.length > 0 ? `${label(c)} cannot supply ${missing.join(", ")}` : null;
      })
      .filter((x): x is string => x !== null);
    expect(offenders).toEqual([]);
  });

  it("no claim nested under a folder or session declares depth 1", () => {
    // A surface declared at the same depth as its own parent loses the
    // strictly-shallower history fast-path and falls through to `/`, ejecting
    // the user from the folder or session it was opened from.
    const offenders = claims.filter(
      (c) => c.claim.depth === 1 && /^\/(folder|session)\/:[^/]+\/.+/.test(c.path),
    );
    expect(offenders.map(label)).toEqual([]);
  });
});
