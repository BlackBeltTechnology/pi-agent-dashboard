/**
 * Message builder + startup assertion for unsupported Node versions.
 *
 * The predicate `isOutOfEnginesRange` lives in
 * `@blackbelt-technology/pi-dashboard-shared/node-version.js` — the single
 * source of truth shared with the Electron doctor. It is re-exported here so
 * this module's public API and the `server-startup-node-version-guard` spec
 * wording ("node-guard.ts SHALL expose …") stay intact.
 *
 * The separate nodejs/node#58515 startup check (`isAffectedNode` +
 * `buildNodeUpgradeMessage`) was removed in change `raise-node-floor-to-26`:
 * the affected ranges (22.0–22.18, 24.1–24.2) lie entirely below the Node 26
 * floor, so the engines-range check subsumes it.
 *
 * See change: unify-node-version-gate, raise-node-floor-to-26 (design D9).
 * See change: unify-pi-runtime-identity (task 6.3 — managed hint is emitted
 * only when a managed Node runtime actually exists under `<managedDir>/node/`).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getManagedDir } from "@blackbelt-technology/pi-dashboard-shared/managed-paths.js";
import { isOutOfEnginesRange } from "@blackbelt-technology/pi-dashboard-shared/node-version.js";
import { isJitiLoader, isTsxLoader } from "@blackbelt-technology/pi-dashboard-shared/platform/node-spawn.js";
import { legacyTsLoaderEnvWarning } from "@blackbelt-technology/pi-dashboard-shared/platform/ts-loader-select.mjs";

export { isOutOfEnginesRange };

export interface EnginesRangeMessageOpts {
  /** Managed install dir to probe; default `getManagedDir()`. */
  managedDir?: string;
  /** Hard override for tests; wins over the on-disk probe. */
  managedNodeExists?: boolean;
}

/**
 * True when a managed Node runtime is installed under `<managedDir>/node/`
 * AND its `.version` marker names a Node inside the engines range. Reads the
 * marker only — never spawns Node. Missing / unreadable / below-floor marker
 * → false (the hint would be dead advice). See change: raise-node-floor-to-26.
 */
function managedNodeQualifies(opts: EnginesRangeMessageOpts): boolean {
  if (opts.managedNodeExists !== undefined) return opts.managedNodeExists;
  try {
    const nodeDir = path.join(opts.managedDir ?? getManagedDir(), "node");
    if (!existsSync(nodeDir)) return false;
    const version = readFileSync(path.join(nodeDir, ".version"), "utf8").trim();
    return /^v?\d+\.\d+\.\d+/.test(version) && !isOutOfEnginesRange(version);
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
    `    Required: >=26.0.0 <27 (see package.json#engines.node).`,
    ``,
    `    Below the floor: the dashboard server supports Node 26 only (npm refuses`,
    `    with EBADENGINE). At/above the cap (Node 27+): untested; raise the cap when ready.`,
    `    No Node 26 at hand? The desktop app bundles its own Node.`,
    ``,
    `    Fix:`,
    `      nvm:    nvm install 26 && nvm use 26`,
  ];
  // Managed hint only when the managed runtime exists AND qualifies — a
  // missing or below-floor runtime makes the prepend dead advice.
  if (managedNodeQualifies(opts)) {
    lines.push(`      bundled: PATH="$HOME/.pi-dashboard/node/bin:$PATH" pi-dashboard start`);
  }
  lines.push(`      brew:   brew install node`, ``);
  return lines.join("\n");
}

/**
 * Call at the top of every server entry point (cmdStart, runForeground).
 * Writes the engines-range message to stderr and exits with code 1 when the
 * running Node is outside the engines range. This is the only startup
 * Node-version check.
 */
export function assertNodeVersionSupported(): void {
  if (isOutOfEnginesRange(process.version)) {
    console.error(buildEnginesRangeMessage(process.version));
    process.exit(1);
  }
}

/**
 * Warning for a server that booted under a non-native TypeScript loader, or
 * `null`. A jiti or tsx `--import` is recognised and named; any other
 * `--import` (e.g. a tracing hook) is left alone because it is not provably a
 * TypeScript loader. This happens when a pre-upgrade server restarts itself
 * and hands the new process its own jiti `--import`.
 * See change: strip-only-native-ts-loader (design D5).
 */
export function foreignTsLoaderWarning(execArgv: readonly string[] = process.execArgv): string | null {
  for (let i = 0; i < execArgv.length; i++) {
    const arg = execArgv[i] ?? "";
    // Both `--import <url>` and the combined `--import=<url>` spellings.
    const loader = arg === "--import" ? (execArgv[i + 1] ?? "") : arg.startsWith("--import=") ? arg.slice("--import=".length) : null;
    if (loader === null) continue;
    const name = isJitiLoader(loader) ? "jiti" : isTsxLoader(loader) ? "tsx" : null;
    if (name) {
      return (
        `[pi-dashboard] server booted under the ${name} TypeScript loader (${loader}), which is no longer supported; ` +
        "run `pi-dashboard stop && pi-dashboard start` to switch to the native loader."
      );
    }
  }
  return null;
}

/**
 * Boot-time TypeScript-loader hygiene, run once by the server process: warn on
 * a legacy `PI_DASHBOARD_TS_LOADER` value and on a foreign loader. Only the
 * server logs these; wrappers and launchers neither warn nor rewrite the env.
 */
export function warnTsLoaderState(
  env: Record<string, string | undefined> = process.env,
  execArgv: readonly string[] = process.execArgv,
  warn: (msg: string) => void = console.warn,
): void {
  const legacy = legacyTsLoaderEnvWarning(env);
  if (legacy) warn(`[pi-dashboard] ${legacy}`);
  const foreign = foreignTsLoaderWarning(execArgv);
  if (foreign) warn(foreign);
}
