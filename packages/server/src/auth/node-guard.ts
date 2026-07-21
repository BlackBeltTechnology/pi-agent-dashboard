/**
 * Message builders + startup assertion for unsupported Node versions.
 *
 * The two predicates (`isAffectedNode`, `isOutOfEnginesRange`) now live in
 * `@blackbelt-technology/pi-dashboard-shared/node-version.js` — the single
 * source of truth shared with the Electron doctor. They are re-exported here
 * so this module's public API and the `server-startup-node-version-guard`
 * spec wording ("node-guard.ts SHALL expose …") stay intact.
 *
 * Rationale for a preflight refuse-to-start (instead of a preload workaround):
 * see openspec/changes/adapt-windows-integration-pr9/proposal.md and
 * BRANCH-COMPARISON.md §10 on origin/windows-integration.
 *
 * See change: unify-node-version-gate.
 */
import {
  isAffectedNode,
  isOutOfEnginesRange,
} from "@blackbelt-technology/pi-dashboard-shared/node-version.js";

export { isAffectedNode, isOutOfEnginesRange };

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
