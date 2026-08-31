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
 * See change: unify-pi-runtime-identity (task 6.3 — managed hint is emitted
 * only when a managed Node runtime actually exists under `<managedDir>/node/`).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { getManagedDir } from "@blackbelt-technology/pi-dashboard-shared/managed-paths.js";
import {
  isAffectedNode,
  isOutOfEnginesRange,
} from "@blackbelt-technology/pi-dashboard-shared/node-version.js";

export { isAffectedNode, isOutOfEnginesRange };

export interface EnginesRangeMessageOpts {
  /** Managed install dir to probe; default `getManagedDir()`. */
  managedDir?: string;
  /** Hard override for tests; wins over the on-disk probe. */
  managedNodeExists?: boolean;
}

/** True when a managed Node runtime is installed under `<managedDir>/node/`. */
function managedNodeInstalled(opts: EnginesRangeMessageOpts): boolean {
  if (opts.managedNodeExists !== undefined) return opts.managedNodeExists;
  try {
    return existsSync(path.join(opts.managedDir ?? getManagedDir(), "node"));
  } catch {
    return false;
  }
}

export function buildEnginesRangeMessage(
  version: string,
  opts: EnginesRangeMessageOpts = {},
): string {
  const lines = [
    ``,
    `❌  pi-dashboard cannot start on Node ${version}.`,
    ``,
    `    Required: >=22.19.0 <27 (see package.json#engines.node).`,
    ``,
    `    Below the floor: npm refuses with EBADENGINE and pi 0.75+ assumes`,
    `    22.19 APIs. At/above the cap (Node 27+): untested; raise the cap when ready.`,
    ``,
    `    Fix:`,
    `      nvm:    nvm install 24 && nvm use 24`,
  ];
  // Managed hint only when the managed runtime actually exists — without
  // one the prepend is dead advice. Existence probe only; never a write.
  if (managedNodeInstalled(opts)) {
    lines.push(`      bundled: PATH="$HOME/.pi-dashboard/node/bin:$PATH" pi-dashboard start`);
  }
  lines.push(`      brew:   brew install node@24`, ``, );
  return lines.join("\n");
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
