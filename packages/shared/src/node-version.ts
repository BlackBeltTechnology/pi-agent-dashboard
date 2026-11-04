/**
 * Canonical Node.js version predicates — single source of truth.
 *
 * Both the dashboard server's startup guard (`packages/server/src/auth/node-guard.ts`,
 * which re-exports `isOutOfEnginesRange`) and the Electron doctor's system-Node
 * detection (`packages/electron/src/lib/dependency-detector.ts`, which consumes
 * `isUsableNodeVersion`) import from here. No package keeps a private inline
 * copy — that is the drift hazard this module exists to remove.
 *
 * Two floors, one cap:
 *
 *   - Dashboard server range: root `package.json#engines.node` (`>=26.0.0 <27`).
 *     Floor = `MIN_SERVER_NODE`; at/above the cap (`>=27`): untested, refused.
 *     The floor moved 22.19.0 -> 26.0.0 in change `raise-node-floor-to-26`
 *     (Node 26 Active LTS 2026-10-28).
 *
 *   - pi spawn floor: `MIN_PI_SPAWN_NODE` (`22.19.0`, pi's own engines floor),
 *     used only by the pi-session spawn-runtime ladder together with
 *     `isAffectedNode`.
 *
 *   - nodejs/node#58515 Fastify-affected: Node v22.0–v22.18 and v24.1–v24.2
 *     (`ERR_INTERNAL_ASSERTION: Unexpected module status 3`). Entirely below
 *     the server floor, so the server no longer checks it at startup; it stays
 *     exported solely for the pi-session ladder gate.
 *
 * Cap history: `<25` (openspec-worktree-spawn-button) -> `<26` -> `<27`
 * (fix-pi-install-node26-and-omit-dev-build, issue #357).
 *
 * Lockstep contract: when `package.json#engines.node` changes, only this file
 * changes — plus the `_smoke.yml` `standalone-install-smoke-linux` Node-major
 * set (currently `26`), which must cover exactly the supported majors. The
 * `Required: >=26.0.0 <27` literal in `buildEnginesRangeMessage`
 * (`packages/server/src/auth/node-guard.ts`) is a cap site the contract cannot
 * express in code; it is guarded by the `node-cap-message-matches-engines`
 * repo-lint instead. See change: unify-node-version-gate, raise-node-floor-to-26.
 */

/**
 * Dashboard SERVER floor — the lower bound of root `package.json#engines.node`
 * (`>=26.0.0 <27`) and `packages/server` (`>=26.0.0`). `isOutOfEnginesRange`
 * implements its floor half THROUGH this constant + `meetsFloor`, and the
 * server-spawn resolver (`spawn-runtime.ts` `resolveServerRuntime`) gates on
 * that predicate — no consumer carries a private floor literal.
 * See change: raise-node-floor-to-26 (design D2/D3).
 */
export const MIN_SERVER_NODE = "26.0.0";

/**
 * pi SPAWN floor — pi's own `engines.node` minimum (pi 0.75+ ships
 * `>=22.19.0`). The pi-session spawn-runtime ladder
 * (`packages/shared/src/platform/spawn-runtime.ts`) gates candidates against
 * the floor read from the spawned pi copy, falling back to this constant when
 * unreadable. Distinct from `MIN_SERVER_NODE`: raising the server floor SHALL
 * NOT raise the floor applied to pi-session spawns.
 * Lockstep-guarded by `node-version.test.ts` and the floor-vs-pi repo-lint in
 * `bundled-node-meets-pi-floor.test.ts` (`MIN_SERVER_NODE` >= pi's floor).
 * See change: unify-pi-runtime-identity (task 1.1), raise-node-floor-to-26 (D3).
 */
export const MIN_PI_SPAWN_NODE = "22.19.0";

/**
 * The dashboard server engines range as text (`>=26.0.0 <27`) — for
 * diagnostics and user-facing notices. Built from `MIN_SERVER_NODE` + the cap
 * so no consumer re-types the range. Lint-pinned to root
 * `package.json#engines.node` by `node-version.test.ts`.
 */
export const SERVER_ENGINES_RANGE = `>=${MIN_SERVER_NODE} <27`;

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
 * True when Node is OUTSIDE the dashboard server engines range
 * (`>=26.0.0 <27`): below `MIN_SERVER_NODE`, or major >= 27.
 * Unparseable input returns false ("not provably out of range").
 */
export function isOutOfEnginesRange(version: string): boolean {
  const m = version.match(NODE_VERSION_RE);
  if (!m) return false;
  // Floor half implemented THROUGH the canonical constant — lockstep by
  // construction, not by convention.
  if (!meetsFloor(version, MIN_SERVER_NODE)) return true;
  return isAtOrAboveEnginesCap(version);
}

/**
 * True when `version` is something the dashboard server will actually run on:
 * a clean semver within the engines range. Accept-set: 26.x only. The
 * #58515 affected ranges lie below the floor, so no separate check is needed.
 * See change: raise-node-floor-to-26.
 */
export function isUsableNodeVersion(version: string): boolean {
  // Unparseable / non-version strings are NOT usable: isOutOfEnginesRange
  // returns false ("not out of range") on no-match.
  if (!NODE_VERSION_RE.test(version)) return false;
  return !isOutOfEnginesRange(version);
}
