/**
 * Dual-scope automation scanner.
 *
 * Scans per-folder (`<repo>/.pi/automation/`) and global
 * (`~/.pi/automation/`) scopes, parsing each `<name>/automation.yaml`.
 * Each discovered automation is tagged with its scope. Invalid files are
 * surfaced as `valid:false` entries (isolated failure) so siblings keep
 * loading. Name collisions across scopes are kept as distinct entries.
 *
 * See change: add-automation-plugin.
 */
import fs from "node:fs";
import path from "node:path";
import { parseAutomationYaml } from "./automation-schema.js";
import type { AutomationScope, DiscoveredAutomation } from "../shared/automation-types.js";

/** The `.pi/automation/` subdir holding `<name>/automation.yaml` dirs. */
export function automationRootFor(scopeBase: string): string {
  return path.join(scopeBase, ".pi", "automation");
}

/** Scan a single scope base directory (`<repo>` or `~`). */
export function scanScope(
  scopeBase: string,
  scope: AutomationScope,
  knownKinds: ReadonlySet<string>,
  knownActionIds: ReadonlySet<string> = new Set(),
): DiscoveredAutomation[] {
  const root = automationRootFor(scopeBase);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return []; // no automation dir for this scope
  }

  const out: DiscoveredAutomation[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    // `runs/` is the run-store dir, not an automation.
    if (ent.name === "runs") continue;
    const dir = path.join(root, ent.name);
    const yamlPath = path.join(dir, "automation.yaml");
    let rawText: string;
    try {
      rawText = fs.readFileSync(yamlPath, "utf-8");
    } catch {
      continue; // no automation.yaml — skip silently
    }
    const { config, error } = parseAutomationYaml(rawText, knownKinds, knownActionIds);
    if (config) {
      out.push({ name: ent.name, scope, dir, config, valid: true });
    } else {
      out.push({ name: ent.name, scope, dir, valid: false, error: error ?? "invalid" });
    }
  }
  return out;
}

export interface ScanOptions {
  /** Repo root (per-folder scope). Omit to skip the folder scope. */
  repoRoot?: string;
  /** Home dir (global scope). Omit to skip the global scope. */
  homeDir?: string;
  scanFolder?: boolean;
  scanGlobal?: boolean;
}

/**
 * Scan both scopes and merge. Folder + global are returned together; a name
 * present in both scopes yields two distinct entries (different `scope`).
 */
export function scanAutomations(
  opts: ScanOptions,
  knownKinds: ReadonlySet<string>,
  knownActionIds: ReadonlySet<string> = new Set(),
): DiscoveredAutomation[] {
  const out: DiscoveredAutomation[] = [];
  if (opts.scanFolder !== false && opts.repoRoot) {
    out.push(...scanScope(opts.repoRoot, "folder", knownKinds, knownActionIds));
  }
  if (opts.scanGlobal !== false && opts.homeDir) {
    out.push(...scanScope(opts.homeDir, "global", knownKinds, knownActionIds));
  }
  return out;
}
