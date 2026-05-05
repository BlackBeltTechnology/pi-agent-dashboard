/**
 * Bootstrap install reconciler driven by ~/.pi/dashboard/installable.json.
 * Invoked by cli.ts before app.listen.
 *
 * File-absent path is a deliberate no-op: Bridge and Standalone starters
 * never write installable.json; only Electron seeds it on first run.
 * When the file is absent, this function logs and returns immediately so
 * bootstrap.status transitions to "ready" without delay.
 *
 * See change: simplify-electron-bootstrap-derived-state.
 */
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { getManagedDir } from "@blackbelt-technology/pi-dashboard-shared/managed-paths.js";
import {
  readInstallableList,
  type InstallablePackage,
} from "@blackbelt-technology/pi-dashboard-shared/installable-list.js";
import { bootstrapInstall } from "@blackbelt-technology/pi-dashboard-shared/bootstrap-install.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import type { BootstrapStateStore } from "./bootstrap-state.js";

// ── Injectable helpers (overridable in tests) ──────────────────────────────

export type InstallProgressCallback = (line: string) => void;
export type PackageInstaller = (
  pkg: InstallablePackage,
  onOutput: InstallProgressCallback,
) => Promise<void>;

// ── Installed-check ────────────────────────────────────────────────────────

/**
 * Return true if `pkgName` is resolvable from `managedDir/node_modules`.
 * Version satisfies check is intentionally omitted (no semver dep) —
 * we treat "resolves at all" as satisfied. This is sufficient for the
 * Phase B bootstrap use case.
 */
export function isNpmPackageInstalled(pkgName: string, managedDir: string): boolean {
  try {
    // createRequire resolves from the given path; look in managedDir/node_modules.
    const req = createRequire(path.join(managedDir, "package.json"));
    req.resolve(pkgName + "/package.json");
    return true;
  } catch {
    return false;
  }
}

// ── Default installers ─────────────────────────────────────────────────────

async function defaultNpmInstall(
  pkg: InstallablePackage,
  managedDir: string,
  onOutput: InstallProgressCallback,
): Promise<void> {
  const spec =
    pkg.version && pkg.version !== "*"
      ? `${pkg.name}@${pkg.version}`
      : pkg.name;
  const res = await bootstrapInstall({
    packages: [spec],
    managedDir,
    progress: (p) => {
      if (p.output) onOutput(p.output);
    },
  });
  if (!res.ok) {
    throw new Error(res.error);
  }
}

async function defaultPiExtensionInstall(
  pkg: InstallablePackage,
  onOutput: InstallProgressCallback,
): Promise<void> {
  const registry = getDefaultRegistry();
  const { module: piModule } = await registry.resolveModule<{
    DefaultPackageManager: any;
    SettingsManager: any;
  }>("pi-coding-agent");
  const agentDir = path.join(os.homedir(), ".pi", "agent");
  const settingsManager = piModule.SettingsManager.create(process.cwd(), agentDir);
  const pm = new piModule.DefaultPackageManager({
    cwd: process.cwd(),
    agentDir,
    settingsManager,
  });
  pm.setProgressCallback((event: { message?: string }) => {
    if (event.message) onOutput(event.message);
  });
  await pm.installAndPersist(pkg.name, { local: false });
}

// ── Options ────────────────────────────────────────────────────────────────

export interface BootstrapInstallFromListOptions {
  /** Override config dir for installable.json (default: ~/.pi/dashboard/). */
  configDir?: string;
  /** Override managed dir for npm installs (default: ~/.pi-dashboard/). */
  managedDir?: string;
  /**
   * Injectable npm installer. Defaults to bootstrapInstall.
   * Receives the InstallablePackage and a streaming output callback.
   */
  npmInstall?: PackageInstaller;
  /**
   * Injectable pi-extension installer. Defaults to pi DefaultPackageManager.
   * Receives the InstallablePackage and a streaming output callback.
   */
  piInstall?: PackageInstaller;
  /**
   * Injectable installed-check for npm packages.
   * Defaults to isNpmPackageInstalled.
   */
  isInstalled?: (pkg: InstallablePackage, managedDir: string) => boolean;
}

// ── Main reconciler ────────────────────────────────────────────────────────

/**
 * Reconcile packages from installable.json against the managed directory.
 *
 * - File absent: log and return immediately (not a failure).
 * - Per package: check installed → skip or install.
 * - Required failure: set bootstrap status=failed, throw (abort server start).
 * - Optional failure: log, record in failed[], continue.
 */
export async function bootstrapInstallFromList(
  bootstrapState: BootstrapStateStore,
  opts?: BootstrapInstallFromListOptions,
): Promise<void> {
  const configDir =
    opts?.configDir ?? path.join(os.homedir(), ".pi", "dashboard");
  const managedDir = opts?.managedDir ?? getManagedDir();

  // Read installable.json; absent file is a deliberate no-op.
  const list = await readInstallableList(configDir);
  if (list === null) {
    console.log(
      "[bootstrap] bootstrap.installable.skipped reason=file-not-found",
    );
    return;
  }

  // Only process packages that are active (not deprecated, not defaultOff).
  const packages = list.packages.filter((p) => !p.deprecated && !p.defaultOff);
  const total = packages.length;
  let installedCount = 0;
  const failed: string[] = [];

  // Stamp initial installable progress into bootstrap state.
  bootstrapState.set({ installable: { total, installed: 0, failed: [] } });

  const checkInstalled =
    opts?.isInstalled ?? ((p, dir) => isNpmPackageInstalled(p.name, dir));
  const doNpmInstall: PackageInstaller =
    opts?.npmInstall ??
    ((p, cb) => defaultNpmInstall(p, managedDir, cb));
  const doPiInstall: PackageInstaller =
    opts?.piInstall ?? defaultPiExtensionInstall;

  for (const pkg of packages) {
    // Fast path: already installed (npm packages only; pi-extension always attempts).
    if (pkg.kind === "npm" && checkInstalled(pkg, managedDir)) {
      console.log(
        `[bootstrap] bootstrap.installable.package name=${pkg.name} status=satisfied`,
      );
      installedCount++;
      bootstrapState.set({
        installable: { total, installed: installedCount, failed },
      });
      continue;
    }

    // Emit installing progress.
    bootstrapState.set({
      progress: { step: pkg.name, output: "installing..." },
      installable: { total, installed: installedCount, failed },
    });

    try {
      const onOutput = (line: string): void => {
        bootstrapState.set({ progress: { step: pkg.name, output: line } });
      };

      if (pkg.kind === "npm") {
        await doNpmInstall(pkg, onOutput);
      } else {
        await doPiInstall(pkg, onOutput);
      }

      installedCount++;
      bootstrapState.set({
        progress: undefined,
        installable: { total, installed: installedCount, failed },
      });
      console.log(
        `[bootstrap] bootstrap.installable.package name=${pkg.name} status=done`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[bootstrap] bootstrap.installable.package name=${pkg.name} status=error error=${message}`,
      );
      failed.push(pkg.name);
      bootstrapState.set({
        progress: undefined,
        installable: { total, installed: installedCount, failed: [...failed] },
      });

      if (pkg.required) {
        const errorMessage = `Required package "${pkg.name}" failed to install: ${message}`;
        bootstrapState.set({
          status: "failed",
          error: { message: errorMessage },
        });
        throw new Error(errorMessage);
      }
      // Optional package failure: log, continue to next package.
    }
  }

  // Final state snapshot.
  bootstrapState.set({
    installable: { total, installed: installedCount, failed },
  });
  console.log(
    `[bootstrap] bootstrap.installable.done total=${total} installed=${installedCount} failed=${failed.length}`,
  );
}
