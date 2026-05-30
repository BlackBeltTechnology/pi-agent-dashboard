/**
 * Pure predicate + message builder for nodejs/node#58515 affected versions.
 *
 * The bug (`ERR_INTERNAL_ASSERTION: Unexpected module status 3`) fires when
 * Fastify loads its internal ajv-compiler under affected Node versions.
 *
 * Affected: Node v22.0–v22.18 and v24.1–v24.2.
 * Fixed in: v22.19+, v24.3+, v25.x.
 *
 * 22.x cutoff widened from `< 22.18` to `< 22.19` in change
 * `bump-pi-compat-to-0-75` (pi 0.75.0 raised its own Node floor to 22.19;
 * mirror it here so the runtime guard matches the engines.node floor).
 * If `packages/electron/src/lib/pick-node.ts::isBundledNodeAffected`
 * exists as a deliberate mirror, it MUST move in lockstep.
 *
 * Rationale for a preflight refuse-to-start (instead of a preload workaround):
 * see openspec/changes/adapt-windows-integration-pr9/proposal.md and
 * BRANCH-COMPARISON.md §10 on origin/windows-integration.
 */

export function isAffectedNode(version: string): boolean {
  const m = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major === 22 && minor < 19) return true;
  if (major === 24 && minor >= 1 && minor < 3) return true;
  return false;
}

/**
 * Returns true when Node is OUTSIDE the engines cap declared in
 * `package.json#engines.node` (`>=22.19.0 <26`). Covers:
 *
 *   - Too old: major < 22, OR major 22 with minor < 19 (overlaps with
 *     isAffectedNode on the 22.x edge — both catch the below-floor case;
 *     the engines guard names the floor explicitly).
 *   - Too new: major >= 26 (speculative cap; future Node 26 work is its
 *     own change).
 *
 * History: cap was briefly `<25` in change `openspec-worktree-spawn-button`
 * commit 63a8d531, on the theory that subprocess `npm ci` (worktree-spawn
 * bootstrap) would EBADENGINE on Node 25 under the old `engines.node <25`.
 * CI smoke matrices had been running Node 25 cleanly the whole time
 * (because they pass `--engine-strict=false`); the dev-reported
 * EBADENGINE was almost certainly an nvm subprocess-PATH artifact, not a
 * real engines failure. Bumping engines to `<26` removes the npm-side
 * trigger at the source and restores Node 25 as a first-class target.
 *
 * Keep this in lockstep with `package.json#engines.node`.
 *
 * See change: openspec-worktree-spawn-button.
 */
export function isOutOfEnginesRange(version: string): boolean {
  const m = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major < 22) return true;
  if (major === 22 && minor < 19) return true;
  if (major >= 26) return true;
  return false;
}

export function buildEnginesRangeMessage(version: string): string {
  return [
    ``,
    `❌  pi-dashboard cannot start on Node ${version}.`,
    ``,
    `    Required: >=22.19.0 <26 (see package.json#engines.node).`,
    ``,
    `    Below the floor: npm refuses with EBADENGINE and pi 0.75+ assumes`,
    `    22.19 APIs. At/above the cap: untested; raise the cap when ready.`,
    ``,
    `    Fix:`,
    `      nvm:    nvm install 24 && nvm use 24`,
    `      bundled: PATH="$HOME/.pi-dashboard/node/bin:$PATH" pi-dashboard start`,
    `      brew:   brew install node@24`,
    ``,
  ].join("\n");
}

export function buildNodeUpgradeMessage(version: string): string {
  return [
    ``,
    `❌  pi-dashboard cannot start on Node ${version}.`,
    ``,
    `    This Node version has a bug that crashes Fastify at startup:`,
    `    https://github.com/nodejs/node/issues/58515`,
    ``,
    `    Fix: upgrade Node to >=22.19.0 (LTS) or >=24.3.0.`,
    `    Install:`,
    `      nvm:   nvm install 22 && nvm use 22`,
    `      brew:  brew upgrade node`,
    `      Win:   https://nodejs.org/  ->  current 22.x LTS installer`,
    ``,
  ].join("\n");
}

/**
 * Call at the top of every server entry point (cmdStart, runForeground).
 * Writes the upgrade message to stderr and exits with code 1 when the
 * running Node is in the affected range.
 */
export function assertNodeVersionSupported(): void {
  if (isAffectedNode(process.version)) {
    console.error(buildNodeUpgradeMessage(process.version));
    process.exit(1);
  }
  if (isOutOfEnginesRange(process.version)) {
    console.error(buildEnginesRangeMessage(process.version));
    process.exit(1);
  }
}
