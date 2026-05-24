/**
 * pick-node.ts — select the Node.js binary used to spawn the dashboard server.
 *
 * Under the immutable-bundle architecture (see change:
 * eliminate-electron-runtime-install), the bundled Node binary is the
 * only supported choice:
 *
 *   <resourcesPath>/node/bin/node       (POSIX)
 *   <resourcesPath>/node/node.exe       (Windows)
 *
 * The previous system-vs-bundled selection logic existed only to defend
 * against runtime-extraction failure modes that cannot occur once
 * Electron is a pure launcher reading from read-only resources.
 *
 * Pure function: all inputs are injected so tests stay free of real I/O.
 */
import path from "node:path";
import { existsSync as fsExistsSync } from "node:fs";

export interface PickNodeInput {
  /** Resolved Resources/node dir. Required — bundled Node must exist for packaged Electron. */
  bundledNodeDir: string | null;
  /** Injected for testability; production caller passes process.execPath. */
  processExecPath: string;
  /** Injected for testability; production caller passes process.platform. */
  platform: NodeJS.Platform;
  /** Injected for testability; defaults to existsSync from node:fs. */
  existsSync?: (p: string) => boolean;
}

export type PickNodeResult =
  | { kind: "bundled"; nodeBin: string }
  | { kind: "execpath-fallback"; nodeBin: string; needsElectronRunAsNode: true };

/**
 * Determine which Node binary to use for spawning the dashboard server.
 *
 * Returns the bundled Node when available. Falls back to Electron's own
 * execPath (with `ELECTRON_RUN_AS_NODE=1`) only when bundled Node is
 * missing — a corrupted-install signal, not a normal operating mode.
 *
 * IMPORTANT: process.execPath is referenced only through the injected
 * `processExecPath` field — sole allowed site per no-electron-execpath-spawn lint.
 */
export function pickNodeForServer(input: PickNodeInput): PickNodeResult {
  const { bundledNodeDir, processExecPath, platform } = input;
  const fsExists = input.existsSync ?? fsExistsSync;

  if (bundledNodeDir) {
    const pjoin = platform === "win32" ? path.win32.join : path.posix.join;
    const nodeBin =
      platform === "win32"
        ? pjoin(bundledNodeDir, "node.exe")
        : pjoin(bundledNodeDir, "bin", "node");
    if (fsExists(nodeBin)) {
      return { kind: "bundled", nodeBin };
    }
  }

  // Bundled Node missing — corrupted install. Use Electron's own binary
  // (with ELECTRON_RUN_AS_NODE=1) so the user at least sees an error,
  // not a silent no-op.
  return { kind: "execpath-fallback", nodeBin: processExecPath, needsElectronRunAsNode: true };
}

/**
 * Build the bundledNodeDir path from the app resources path.
 */
export function bundledNodeDirFromResources(resourcesPath: string): string {
  return path.join(resourcesPath, "node");
}
