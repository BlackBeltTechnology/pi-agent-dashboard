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
 * `package.json#engines.node` (`>=22.19.0 <25`). Covers two cases the
 * Fastify-bug guard doesn't:
 *
 *   - Too old: major 22 with minor < 19 (overlap with isAffectedNode — both
 *     catch this; the engines guard is the canonical answer).
 *   - Too new: major >= 25. Even though Node 25 fixes the Fastify bug, the
 *     dashboard's engines field caps at <25 because subprocess `npm ci`
 *     (worktree bootstrap) refuses with EBADENGINE on out-of-range Node.
 *     Running the server on Node 25 makes the worktree-spawn dialog throw
 *     `bootstrap_failed: node engine mismatch`. Refusing at startup
 *     surfaces the same error early, with an actionable message.
 *
 *   - Catches major < 22 too — anything below the floor is unsupported.
 *
 * Keep this in lockstep with the engines field; if the cap ever bumps to
 * `<26`, drop the 25 check here.
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
  if (major >= 25) return true;
  return false;
}

export function buildEnginesRangeMessage(version: string): string {
  return [
    ``,
    `❌  pi-dashboard cannot start on Node ${version}.`,
    ``,
    `    Required: >=22.19.0 <25 (see package.json#engines.node).`,
    ``,
    `    The worktree-spawn dialog shells out to \`npm ci\` which refuses`,
    `    with EBADENGINE on Node versions outside this range; running the`,
    `    server on an out-of-range Node makes that path silently fail.`,
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
