/**
 * Power-user-mode managed install helper.
 *
 * The Electron app's wizard auto-skips its UI when `pi.found && bridge.found`.
 * Pre-fix, that auto-skip ALSO skipped `installStandalone()`, leaving
 * `~/.pi-dashboard/node_modules/` empty. The bundled server then fell back
 * to the user's system pi for the TS loader, hitting jiti-version drift on
 * machines with `pi-coding-agent@0.71.x` (jiti 2.6.5) and crashing with
 * `MODULE_NOT_FOUND` before the dashboard could start.
 *
 * Fix: every first launch SHALL run `installStandalone()` regardless of
 * wizard-UI state. This module:
 *
 *   - Decides whether to run the install (pure helper `decideStartupAction`)
 *   - Runs it with a small wrapper that adds idempotency on populated dirs
 *
 * Pure helpers are exported so unit tests can exercise the decision matrix
 * (firstRun × pi.found × bridge.found × managed-dir-populated) without any
 * filesystem or npm-spawn side effects.
 *
 * See change: fix-electron-windows-installer-and-server-bootstrap (Defect 1).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { MANAGED_DIR } from "./managed-paths.js";

/** Packages `installStandalone()` writes into MANAGED_DIR. */
export const REQUIRED_MANAGED_PACKAGES: readonly string[] = [
  "@mariozechner/pi-coding-agent",
  "@fission-ai/openspec",
  "tsx",
];

/** Pure inputs for the startup-action decision. */
export interface StartupState {
  firstRun: boolean;
  piFound: boolean;
  bridgeFound: boolean;
}

/** Pure result describing what the Electron main flow should do. */
export type StartupAction =
  | { kind: "skip-everything"; reason: "not-first-run" }
  | { kind: "auto-skip-wizard-with-install"; reason: "power-user" }
  | { kind: "wizard"; step: "bridge-install" | "full" };

/**
 * Decide what the Electron main process should do at startup based on the
 * pure detection state. No I/O; no side effects. Test surface for the
 * "power-user mode still runs install" rule (D6 / Defect 1).
 */
export function decideStartupAction(state: StartupState): StartupAction {
  if (!state.firstRun) {
    return { kind: "skip-everything", reason: "not-first-run" };
  }
  if (state.piFound && state.bridgeFound) {
    // Auto-skip the wizard UI BUT still run the managed install.
    return { kind: "auto-skip-wizard-with-install", reason: "power-user" };
  }
  if (state.piFound && !state.bridgeFound) {
    return { kind: "wizard", step: "bridge-install" };
  }
  return { kind: "wizard", step: "full" };
}

/**
 * Idempotency probe: returns true when every required package's
 * `package.json` is present under MANAGED_DIR/node_modules. Pure I/O,
 * no spawn. Used to gate whether `installStandalone()` is a no-op.
 *
 * Note: this is a presence check, not a version check. The downstream
 * `installStandalone()` does its own version reconciliation.
 */
export function isManagedDirPopulated(managedDir: string = MANAGED_DIR): boolean {
  for (const pkg of REQUIRED_MANAGED_PACKAGES) {
    const pkgJson = path.join(
      managedDir,
      "node_modules",
      ...pkg.split("/"),
      "package.json",
    );
    if (!existsSync(pkgJson)) return false;
    try {
      // Smoke-check that the file parses as JSON; corrupt entries trigger
      // a full re-install via the downstream installer.
      JSON.parse(readFileSync(pkgJson, "utf8"));
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Wrapper around `installStandalone()` that:
 *   - Short-circuits when the managed dir is already populated (idempotent).
 *   - Calls `installStandalone()` for any missing/corrupt state. The
 *     installer itself handles offline-cacache extraction, version
 *     reconciliation, and partial-state recovery.
 *
 * `installStandaloneFn` is injectable for tests so they don't have to
 * spawn npm.
 */
export async function runPowerUserManagedInstall(args: {
  installStandaloneFn: (
    onProgress?: (p: { step: string; status: string; output?: string; error?: string }) => void,
    skipPackages?: string[],
  ) => Promise<void>;
  onStatus?: (status: string) => void;
  managedDir?: string;
}): Promise<{ ran: boolean; reason: "already-populated" | "installed" | "failed"; error?: Error }> {
  const managedDir = args.managedDir ?? MANAGED_DIR;
  if (isManagedDirPopulated(managedDir)) {
    return { ran: false, reason: "already-populated" };
  }
  args.onStatus?.("Setting up dependencies\u2026");
  try {
    await args.installStandaloneFn((p) => {
      if (p.output) args.onStatus?.(`Setting up dependencies\u2026 ${p.output}`);
    });
    return { ran: true, reason: "installed" };
  } catch (err) {
    return {
      ran: true,
      reason: "failed",
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
