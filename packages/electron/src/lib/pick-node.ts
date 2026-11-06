/**
 * pick-node.ts — select the Node.js binary used to spawn the dashboard server.
 *
 * Order (change raise-node-floor-to-26, design D7):
 *
 *   1. bundled  — `<resourcesPath>/node/bin/node` (POSIX) /
 *                 `<resourcesPath>/node/node.exe` (Windows). The normal case
 *                 for every packaged app.
 *   2. system   — a pre-resolved Node satisfying the server engines range
 *                 (`resolveServerRuntime`, run by `launch-source.ts` ONLY when
 *                 the bundled binary is missing: dev / localLink / overlay).
 *   3. execpath-fallback — Electron's own executable with
 *                 `ELECTRON_RUN_AS_NODE=1`, ONLY when its embedded Node
 *                 (`process.versions.node`) satisfies the server range.
 *   4. unavailable — none qualifies; the caller surfaces `reason` as a
 *                 user-facing error and never calls `launchDashboardServer`.
 *
 * Pure and synchronous: all inputs are injected so tests stay free of real I/O.
 */
import { existsSync as fsExistsSync } from "node:fs";
import path from "node:path";
import { isUsableNodeVersion, SERVER_ENGINES_RANGE } from "@blackbelt-technology/pi-dashboard-shared/node-version.js";

export interface PickNodeInput {
  /** Resolved Resources/node dir. Required — bundled Node must exist for packaged Electron. */
  bundledNodeDir: string | null;
  /** Injected for testability; production caller passes process.execPath. */
  processExecPath: string;
  /** Injected for testability; production caller passes process.platform. */
  platform: NodeJS.Platform;
  /** Injected for testability; defaults to existsSync from node:fs. */
  existsSync?: (p: string) => boolean;
  /**
   * Electron's embedded Node version (`process.versions.node`). The
   * execPath fallback is chosen only when this satisfies the server range.
   */
  embeddedNodeVersion: string;
  /** A qualifying system Node pre-resolved by the caller (bundled missing only). */
  systemNode?: { nodeBin: string; version: string } | null;
}

export type PickNodeResult =
  | { kind: "bundled"; nodeBin: string }
  | { kind: "system"; nodeBin: string; version: string }
  | { kind: "execpath-fallback"; nodeBin: string; needsElectronRunAsNode: true }
  | { kind: "unavailable"; reason: string };

/** Path of the bundled Node binary inside `bundledNodeDir` for `platform`. */
function bundledBinary(bundledNodeDir: string, platform: NodeJS.Platform): string {
  return platform === "win32"
    ? path.win32.join(bundledNodeDir, "node.exe")
    : path.posix.join(bundledNodeDir, "bin", "node");
}

/**
 * Determine which Node binary to use for spawning the dashboard server.
 *
 * IMPORTANT: process.execPath is referenced only through the injected
 * `processExecPath` field — sole allowed site per no-electron-execpath-spawn lint.
 */
export function pickNodeForServer(input: PickNodeInput): PickNodeResult {
  const { bundledNodeDir, processExecPath, platform } = input;
  const fsExists = input.existsSync ?? fsExistsSync;

  if (bundledNodeDir) {
    const nodeBin = bundledBinary(bundledNodeDir, platform);
    if (fsExists(nodeBin)) return { kind: "bundled", nodeBin };
  }

  if (input.systemNode) {
    return { kind: "system", nodeBin: input.systemNode.nodeBin, version: input.systemNode.version };
  }

  if (isUsableNodeVersion(input.embeddedNodeVersion)) {
    return { kind: "execpath-fallback", nodeBin: processExecPath, needsElectronRunAsNode: true };
  }

  const embedded = input.embeddedNodeVersion.startsWith("v")
    ? input.embeddedNodeVersion
    : `v${input.embeddedNodeVersion}`;
  return {
    kind: "unavailable",
    reason:
      `No Node satisfying ${SERVER_ENGINES_RANGE} is available to run the dashboard server: ` +
      "the bundled Node is missing, no qualifying system Node was found, and Electron's " +
      `embedded Node ${embedded} is outside the range. Install Node 26 (e.g. \`nvm install 26\`).`,
  };
}

/**
 * True when the bundled Node binary exists — lets the caller skip the async
 * system-Node resolution on every packaged launch.
 */
export function hasBundledNode(
  bundledNodeDir: string | null,
  platform: NodeJS.Platform,
  exists: (p: string) => boolean = fsExistsSync,
): boolean {
  return !!bundledNodeDir && exists(bundledBinary(bundledNodeDir, platform));
}

/**
 * Build the bundledNodeDir path from the app resources path.
 */
export function bundledNodeDirFromResources(resourcesPath: string): string {
  return path.join(resourcesPath, "node");
}
