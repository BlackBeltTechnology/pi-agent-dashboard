/**
 * Canonical Node.js version predicates — single source of truth.
 *
 * Both the dashboard server's startup guard (`packages/server/src/node-guard.ts`,
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
 *   - engines cap from root `package.json#engines.node` (`>=22.19.0 <26`).
 *     Below the floor: npm refuses with EBADENGINE and pi 0.75+ assumes 22.19
 *     APIs. At/above the cap (`>=26`): untested.
 *
 * Cap history: briefly `<25` in change `openspec-worktree-spawn-button`
 * (commit 63a8d531), on the theory that subprocess `npm ci` (worktree-spawn
 * bootstrap) would EBADENGINE on Node 25. CI smoke matrices had run Node 25
 * cleanly the whole time (they pass `--engine-strict=false`); the reported
 * EBADENGINE was an nvm subprocess-PATH artifact, not a real engines failure.
 * Cap moved to `<26`, restoring Node 25 as a first-class target. The 22.x
 * Fastify cutoff widened `< 22.18` -> `< 22.19` in change `bump-pi-compat-to-0-75`
 * (pi 0.75.0 raised its own Node floor to 22.19).
 *
 * Lockstep contract: when `package.json#engines.node` or the upstream Fastify
 * fix range changes, only this file changes. See change: unify-node-version-gate.
 */

/**
 * Accept a clean semver triplet, optionally `v`-prefixed, optionally with a
 * `-prerelease` / `+build` suffix (node nightlies report `v25.0.0-nightly...`).
 * Anchored so trailing junk is rejected: `v22.19.0 extra` (space) and a 4th
 * component `22.19.0.1` do NOT match. Sole parser for all three predicates so
 * the "reject unparseable strings" contract holds uniformly.
 */
const NODE_VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

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
 * True when Node is OUTSIDE the engines cap (`>=22.19.0 <26`):
 *   - Too old: major < 22, OR major 22 with minor < 19.
 *   - Too new: major >= 26.
 */
export function isOutOfEnginesRange(version: string): boolean {
  const m = version.match(NODE_VERSION_RE);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major < 22) return true;
  if (major === 22 && minor < 19) return true;
  if (major >= 26) return true;
  return false;
}

/**
 * True when `version` is something the dashboard server will actually run on:
 * within the engines range AND not Fastify-affected. Accept-set:
 * Node 22.19+, 24.0, 24.3–24.x, 25.x. Rejected: 21.x, 22.0–22.18,
 * 24.1–24.2, 26+.
 */
export function isUsableNodeVersion(version: string): boolean {
  // Unparseable / non-version strings are NOT usable. Without this guard a
  // garbage `--version` output would slip through, since both range
  // predicates return false ("not out of range", "not affected") on no-match.
  if (!NODE_VERSION_RE.test(version)) return false;
  return !isOutOfEnginesRange(version) && !isAffectedNode(version);
}
