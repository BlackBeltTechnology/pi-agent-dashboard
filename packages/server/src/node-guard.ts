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
}
