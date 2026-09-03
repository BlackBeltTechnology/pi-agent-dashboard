/**
 * Canonical Node.js version predicates — single source of truth.
 *
 * Both the dashboard server's startup guard (`packages/server/src/auth/node-guard.ts`,
 * which re-exports `isAffectedNode` / `isOutOfEnginesRange`) and the Electron
 * doctor's system-Node detection (`packages/electron/src/lib/dependency-detector.ts`,
 * which consumes `isUsableNodeVersion`) import from here. No package keeps a
 * private inline copy — that is the drift hazard this module exists to remove.
 *
 * Two ranges are encoded:
 *
 *   - nodejs/node#58515 Fastify-affected: Node v22.0–v22.18 and v24.1–v24.2.
 *     The bug (`ERR_INTERNAL_ASSERTION: Unexpected module status 3`) fires when
 *     Fastify loads its internal ajv-compiler under affected Node versions.
 *     Fixed in: v22.19+, v24.3+, v25.x. The 22.x cutoff widened from `< 22.18`
 *     to `< 22.19` in change `bump-pi-compat-to-0-75` (pi 0.75.0 raised its own
 *     Node floor to 22.19).
 *
 *   - engines cap from root `package.json#engines.node` (`>=22.19.0 <27`).
 *     Below the floor: npm refuses with EBADENGINE and pi 0.75+ assumes 22.19
 *     APIs. At/above the cap (`>=27`): untested.
 *
 * Cap history: briefly `<25` in change `openspec-worktree-spawn-button`
 * (commit 63a8d531), on the theory that subprocess `npm ci` (worktree-spawn
 * bootstrap) would EBADENGINE on Node 25. CI smoke matrices had run Node 25
 * cleanly the whole time (they pass `--engine-strict=false`); the reported
 * EBADENGINE was an nvm subprocess-PATH artifact, not a real engines failure.
 * Cap moved to `<26`, restoring Node 25 as a first-class target. The 22.x
 * Fastify cutoff widened `< 22.18` -> `< 22.19` in change `bump-pi-compat-to-0-75`
 * (pi 0.75.0 raised its own Node floor to 22.19).
 * Cap moved `<26` -> `<27` in change `fix-pi-install-node26-and-omit-dev-build`:
 * `pi install git:...` aborted with EBADENGINE on Node 26 (issue #357). Node 26
 * is CI-validated by the `_smoke.yml` `standalone-install-smoke-linux` Node 26
 * legs, which run WITHOUT `--config.engine-strict=false` so the EBADENGINE half
 * of #357 stays regression-tested.
 *
 * Lockstep contract: when `package.json#engines.node` or the upstream Fastify
 * fix range changes, only this file changes — plus the `_smoke.yml`
 * `standalone-install-smoke-linux` Node-major set (currently `22, 24, 25, 26`),
 * which must cover every supported major. (`ci.yml` carries a single
 * `node-version: 22` setup-node step and no Node-major matrix.) The
 * `Required: >=22.19.0 <27` literal in `buildEnginesRangeMessage`
 * (`packages/server/src/auth/node-guard.ts`) is a third cap site the contract
 * cannot express in code; it is guarded by the `node-cap-message-matches-engines`
 * repo-lint instead. See change: unify-node-version-gate.
 */

/**
 * Canonical minimum Node version — the engines floor shared by the dashboard
 * root (`>=22.19.0 <27`), `packages/server` (`>=22.19.0`), and every pi copy
 * the dashboard spawns (pi 0.75+ ships `engines.node: ">=22.19.0"`).
 *
 * Single defining occurrence: `isOutOfEnginesRange` implements its floor half
 * THROUGH this constant + `meetsFloor`, and the spawn-runtime ladder
 * (`packages/shared/src/platform/spawn-runtime.ts`) gates candidates against
 * floors read from the spawned pi copy (or this constant as fallback) — so no
 * consumer carries a private floor literal. Lockstep-guarded by
 * `node-version.test.ts` (constant ⇄ predicate agreement).
 * See change: unify-pi-runtime-identity (task 1.1).
 */
export const MIN_SUPPORTED_NODE = "22.19.0";

/**
 * Accept a clean semver triplet, optionally `v`-prefixed, optionally with a
 * `-prerelease` / `+build` suffix (node nightlies report `v25.0.0-nightly...`).
 * Anchored so trailing junk is rejected: `v22.19.0 extra` (space) and a 4th
 * component `22.19.0.1` do NOT match. Sole parser for all three predicates so
 * the "reject unparseable strings" contract holds uniformly.
 */
const NODE_VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

/** Parse a clean semver triplet (see NODE_VERSION_RE), or null. */
function parseVersionTriplet(version: string): [number, number, number] | null {
  const m = version.match(NODE_VERSION_RE);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareTriplets(
  a: [number, number, number],
  b: [number, number, number],
): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * True when `version` is at or above the dashboard's TESTED engines cap
 * (`>=27`, root package.json). Deliberately separate from
 * `isOutOfEnginesRange`: the pi-spawn gate treats cap excess as advisory
 * (pi declares no cap — a Node 27 user wins step 2 with a Doctor note),
 * while the server's own usability check treats it as a refusal. The `27`
 * literal stays here — the single defining occurrence.
 * See change: unify-pi-runtime-identity (proposal — Version gate, cap divergence).
 */
export function isAtOrAboveEnginesCap(version: string): boolean {
  const v = parseVersionTriplet(version);
  if (!v) return false;
  return v[0] >= 27;
}

/**
 * True when `version` is at or above `floor` (full semver-triplet compare;
 * `v` prefix tolerated; unparseable input on EITHER side is false — a floor
 * we cannot parse must not silently accept a candidate).
 * See change: unify-pi-runtime-identity (task 1.1).
 */
export function meetsFloor(version: string, floor: string): boolean {
  const v = parseVersionTriplet(version);
  const f = parseVersionTriplet(floor);
  if (!v || !f) return false;
  return compareTriplets(v, f) >= 0;
}

/** True when `version` is in the nodejs/node#58515 Fastify-affected range. */
export function isAffectedNode(version: string): boolean {
  const m = version.match(NODE_VERSION_RE);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major === 22 && minor < 19) return true;
  if (major === 24 && minor >= 1 && minor < 3) return true;
  return false;
}

/**
 * True when Node is OUTSIDE the engines cap (`>=22.19.0 <27`):
 *   - Too old: major < 22, OR major 22 with minor < 19.
 *   - Too new: major >= 27.
 */
export function isOutOfEnginesRange(version: string): boolean {
  const m = version.match(NODE_VERSION_RE);
  if (!m) return false;
  // Floor half implemented THROUGH the canonical constant — lockstep by
  // construction, not by convention.
  if (!meetsFloor(version, MIN_SUPPORTED_NODE)) return true;
  return isAtOrAboveEnginesCap(version);
}

/**
 * True when `version` is something the dashboard server will actually run on:
 * within the engines range AND not Fastify-affected. Accept-set:
 * Node 22.19+, 23.x, 24.0, 24.3–24.x, 25.x, 26.x. Rejected: 21.x, 22.0–22.18,
 * 24.1–24.2, 27+. (The accept of 23.x is deliberate — the predicates accept
 * every major between the floor and the cap; the doc comment previously
 * omitted it. See change: unify-pi-runtime-identity, Part 3 docs-drift pass.)
 */
export function isUsableNodeVersion(version: string): boolean {
  // Unparseable / non-version strings are NOT usable. Without this guard a
  // garbage `--version` output would slip through, since both range
  // predicates return false ("not out of range", "not affected") on no-match.
  if (!NODE_VERSION_RE.test(version)) return false;
  return !isOutOfEnginesRange(version) && !isAffectedNode(version);
}
