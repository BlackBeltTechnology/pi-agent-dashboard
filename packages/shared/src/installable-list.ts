/**
 * installable-list.ts — types and helpers for ~/.pi/dashboard/installable.json.
 *
 * This file describes the set of packages the dashboard needs installed.
 * Electron seeds the file on first run; Bridge / Standalone ignore it (file-absent
 * path is a no-op in the server bootstrap). The server reads it during bootstrap.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type InstallableKind = "npm" | "pi-extension";

export interface InstallablePackage {
  name: string;
  /** Semver range or "*". */
  version: string;
  required: boolean;
  kind: InstallableKind;
  deprecated?: boolean;
  defaultOff?: boolean;
}

export interface InstallableList {
  version: string;
  packages: InstallablePackage[];
}

export interface MergeResult {
  list: InstallableList;
  warnings: string[];
}

const VALID_KINDS: ReadonlySet<string> = new Set<InstallableKind>(["npm", "pi-extension"]);

function defaultConfigDir(): string {
  return path.join(os.homedir(), ".pi", "dashboard");
}

function installablePath(configDir: string): string {
  return path.join(configDir, "installable.json");
}

/**
 * Read `~/.pi/dashboard/installable.json` (or `configDir/installable.json`).
 *
 * Returns `null` when the file is absent. Logs a warning and drops entries
 * with an invalid `kind` field. Does NOT create the file.
 */
export async function readInstallableList(
  configDir?: string,
): Promise<InstallableList | null> {
  const dir = configDir ?? defaultConfigDir();
  const filePath = installablePath(dir);

  let raw: string;
  try {
    raw = await fs.promises.readFile(filePath, "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }

  const parsed = JSON.parse(raw) as InstallableList;

  const validPackages: InstallablePackage[] = [];
  for (const pkg of parsed.packages ?? []) {
    if (!VALID_KINDS.has(pkg.kind)) {
      console.warn(
        `[installable-list] Dropping entry "${pkg.name}" with unknown kind "${pkg.kind}".`,
      );
      continue;
    }
    validPackages.push(pkg);
  }

  return { version: parsed.version, packages: validPackages };
}

/**
 * Atomically write `list` to `configDir/installable.json`.
 * Writes a temp file then renames so readers never see a partial write.
 */
export async function writeInstallableList(
  list: InstallableList,
  configDir?: string,
): Promise<void> {
  const dir = configDir ?? defaultConfigDir();
  const filePath = installablePath(dir);
  const tmpPath = filePath + ".tmp." + process.pid;

  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(tmpPath, JSON.stringify(list, null, 2), "utf-8");
  await fs.promises.rename(tmpPath, filePath);
}

/**
 * Pure merge: reconcile a user's `existing` list against the `bundled` defaults.
 *
 * Rules:
 * - Package in both: keep user's pinned version (user wins); emit a warning when
 *   the bundled default differs.
 * - Package in existing but NOT in bundled: keep it, set `deprecated: true`, emit warning.
 * - New `required: true` package in bundled: add it.
 * - New `required: false` package in bundled: add it with `defaultOff: true`.
 * - Result version marker comes from `bundled.version`.
 */
export function mergeInstallableList(
  existing: InstallableList,
  bundled: InstallableList,
): MergeResult {
  const warnings: string[] = [];
  const bundledMap = new Map(bundled.packages.map((p) => [p.name, p]));
  const existingMap = new Map(existing.packages.map((p) => [p.name, p]));

  const merged: InstallablePackage[] = [];

  // Walk existing packages.
  for (const pkg of existing.packages) {
    const bundledPkg = bundledMap.get(pkg.name);
    if (!bundledPkg) {
      // Dropped in bundled → deprecate.
      warnings.push(
        `Package "${pkg.name}" is no longer in the bundled list and has been marked deprecated.`,
      );
      merged.push({ ...pkg, deprecated: true });
    } else {
      // Present in both → user version wins.
      if (pkg.version !== bundledPkg.version) {
        warnings.push(
          `Package "${pkg.name}" is pinned at "${pkg.version}" (bundled default: "${bundledPkg.version}"). User pin preserved.`,
        );
      }
      merged.push({ ...pkg });
    }
  }

  // Walk bundled packages not yet in existing.
  for (const bundledPkg of bundled.packages) {
    if (existingMap.has(bundledPkg.name)) continue;
    if (!bundledPkg.required) {
      merged.push({ ...bundledPkg, defaultOff: true });
    } else {
      merged.push({ ...bundledPkg });
    }
  }

  return {
    list: { version: bundled.version, packages: merged },
    warnings,
  };
}
