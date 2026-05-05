/**
 * Bundle extraction helpers for ~/.pi-dashboard/ management.
 * See change: simplify-electron-bootstrap-derived-state.
 *
 * Manages the lifecycle of the Electron-owned managed dir:
 *   - Version-marker-driven extraction trigger
 *   - Config file migration to ~/.pi/dashboard/migrate/<timestamp>/
 *   - Selective wipe respecting SURVIVE_EXTRACT_DIRS whitelist
 *   - Bundle copy from process.resourcesPath
 */

import path from "node:path";
import { cpSync } from "node:fs";
import {
  existsSync as fsExistsSync,
  readFileSync as fsReadFileSync,
  writeFileSync as fsWriteFileSync,
  mkdirSync as fsMkdirSync,
  readdirSync as fsReaddirSync,
  renameSync as fsRenameSync,
  rmSync as fsRmSync,
  statSync as fsStatSync,
} from "node:fs";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Directory names under ~/.pi-dashboard/ that must survive a bundle wipe.
 * These are Electron-managed runtimes that outlive an individual version.
 * See change: manage-node-runtime-updates for the node/ family contract.
 */
export const SURVIVE_EXTRACT_DIRS = ["node", "node-pending", "node-old"] as const;

/** Single-line version marker file inside the managed dir. */
export const VERSION_MARKER_FILENAME = ".version";

/** Filename patterns that indicate user config files to be migrated out before wipe. */
const CONFIG_MATCHERS: Array<string | RegExp> = [
  /config/i,            // *config*
  "mode.json",
  "recommended-wizard.json",
  "api-key.json",
];

// ── Injectable fs interface ────────────────────────────────────────────────────

/**
 * Subset of node:fs used by bundle-extract functions.
 * Injectable so unit tests can use in-memory state without touching disk.
 */
export interface ExtractFs {
  existsSync(p: string): boolean;
  readFileSync(p: string, enc: "utf-8"): string;
  writeFileSync(p: string, data: string): void;
  mkdirSync(p: string, opts?: { recursive: boolean }): void;
  readdirSync(p: string): string[];
  renameSync(src: string, dst: string): void;
  rmSync(p: string, opts?: { recursive: boolean; force: boolean }): void;
  statSync(p: string): { isDirectory(): boolean };
  /** cpSync is used by extractBundle for the re-extract step. */
  cpSync?(src: string, dst: string, opts: { recursive: boolean }): void;
}

function buildFs(partial?: Partial<ExtractFs>): ExtractFs {
  return {
    existsSync: partial?.existsSync ?? fsExistsSync,
    readFileSync: partial?.readFileSync ?? ((p, enc) => fsReadFileSync(p, enc)),
    writeFileSync: partial?.writeFileSync ?? fsWriteFileSync,
    mkdirSync: partial?.mkdirSync ?? ((p, opts) => fsMkdirSync(p, opts ?? {})),
    readdirSync: partial?.readdirSync ?? ((p) => fsReaddirSync(p) as string[]),
    renameSync: partial?.renameSync ?? fsRenameSync,
    rmSync: partial?.rmSync ?? fsRmSync,
    statSync: partial?.statSync ?? fsStatSync,
    cpSync: partial?.cpSync ?? ((src, dst, opts) => cpSync(src, dst, opts)),
  };
}

// ── Pattern matching ──────────────────────────────────────────────────────────

function matchesConfigPattern(filename: string): boolean {
  return CONFIG_MATCHERS.some((m) =>
    typeof m === "string" ? filename === m : m.test(filename),
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true when the managed dir needs to be (re-)extracted from the bundle.
 *
 * True when:
 *  - managedDir does not exist
 *  - VERSION_MARKER_FILENAME does not exist inside managedDir
 *  - marker content differs from currentVersion
 */
export function needsExtraction(
  managedDir: string,
  currentVersion: string,
  fs?: Partial<ExtractFs>,
): boolean {
  const f = buildFs(fs);
  if (!f.existsSync(managedDir)) return true;
  const markerPath = path.join(managedDir, VERSION_MARKER_FILENAME);
  if (!f.existsSync(markerPath)) return true;
  try {
    const stored = f.readFileSync(markerPath, "utf-8").trim();
    return stored !== currentVersion.trim();
  } catch {
    return true;
  }
}

/**
 * Move config files matching CONFIG_MATCHERS from managedDir → migrateDir.
 * Creates migrateDir lazily (only when at least one file matches).
 * Returns the list of moved filenames.
 * No-op (returns []) when managedDir does not exist.
 */
export function migrateConfigs(
  managedDir: string,
  migrateDir: string,
  fs?: Partial<ExtractFs>,
): string[] {
  const f = buildFs(fs);
  if (!f.existsSync(managedDir)) return [];

  let entries: string[];
  try {
    entries = f.readdirSync(managedDir);
  } catch {
    return [];
  }

  const moved: string[] = [];
  for (const name of entries) {
    if (matchesConfigPattern(name)) {
      f.mkdirSync(migrateDir, { recursive: true });
      f.renameSync(path.join(managedDir, name), path.join(migrateDir, name));
      moved.push(name);
    }
  }
  return moved;
}

/**
 * Selectively wipe managedDir, copy bundle from sourceDir, and write
 * the version marker.
 *
 * Steps:
 *  1. Migrate config files (when migrateDir is provided).
 *  2. Ensure managedDir exists.
 *  3. Wipe every top-level entry NOT in SURVIVE_EXTRACT_DIRS.
 *  4. Throw if sourceDir doesn't exist.
 *  5. cpSync(sourceDir → managedDir, { recursive: true }).
 *  6. Write VERSION_MARKER_FILENAME.
 */
export function extractBundle(
  managedDir: string,
  sourceDir: string,
  currentVersion: string,
  migrateDir?: string,
  fs?: Partial<ExtractFs>,
): void {
  const f = buildFs(fs);

  if (migrateDir) {
    migrateConfigs(managedDir, migrateDir, fs);
  }

  f.mkdirSync(managedDir, { recursive: true });

  // Selective wipe — preserve survive whitelist
  const surviveSet = new Set<string>(SURVIVE_EXTRACT_DIRS);
  let entries: string[];
  try {
    entries = f.readdirSync(managedDir);
  } catch {
    entries = [];
  }
  for (const name of entries) {
    if (!surviveSet.has(name)) {
      f.rmSync(path.join(managedDir, name), { recursive: true, force: true });
    }
  }

  // Verify source
  if (!f.existsSync(sourceDir)) {
    throw new Error("Bundle source directory not found: " + sourceDir);
  }

  // Re-extract
  f.cpSync!(sourceDir, managedDir, { recursive: true });

  // Write version marker
  f.writeFileSync(path.join(managedDir, VERSION_MARKER_FILENAME), currentVersion);
}
