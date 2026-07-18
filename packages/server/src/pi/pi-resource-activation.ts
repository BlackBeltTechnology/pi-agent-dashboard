/**
 * Activation-state bridge to pi's own resolver.
 *
 * pi owns the enable/disable ("activation") dimension of every extension /
 * skill / prompt / theme. Rather than re-implement pi's `+/-<pattern>` glob
 * precedence, the dashboard consumes pi's already-computed answer:
 *   - Read: `PackageManager.resolve()` → `ResolvedPaths`, whose
 *     `ResolvedResource.enabled` pi computed by applying its own precedence.
 *   - Write (toggle, see resource-activation-routes.ts): pi's `SettingsManager`
 *     typed setters — the exact writers pi's `config-selector` uses.
 *
 * See change: folder-resource-activation-toggle.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  getDefaultRegistry,
  type ToolRegistry,
} from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";

/** Mirror of pi's `PathMetadata` (core/package-manager.ts). */
export interface ResolvedResourceMeta {
  source: string;
  scope: string;
  origin: "package" | "top-level";
  baseDir?: string;
}

/** Mirror of pi's `ResolvedResource`. */
export interface ResolvedResource {
  path: string;
  enabled: boolean;
  metadata: ResolvedResourceMeta;
}

/** Mirror of pi's `ResolvedPaths`. */
export interface ResolvedPaths {
  extensions: ResolvedResource[];
  skills: ResolvedResource[];
  prompts: ResolvedResource[];
  themes: ResolvedResource[];
}

/** pi package-source entry: bare string or object filter form. */
export type PiPackageEntry =
  | string
  | { source: string; extensions?: string[]; skills?: string[]; prompts?: string[]; themes?: string[] };

/** Subset of pi's `Settings` this feature reads/writes. */
export interface PiSettings {
  packages?: PiPackageEntry[];
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
  themes?: string[];
}

/** Subset of pi's `SettingsManager` used by the toggle write path. */
export interface PiSettingsManager {
  getGlobalSettings(): PiSettings;
  getProjectSettings(): PiSettings;
  setExtensionPaths(paths: string[]): void;
  setSkillPaths(paths: string[]): void;
  setPromptTemplatePaths(paths: string[]): void;
  setThemePaths(paths: string[]): void;
  setProjectExtensionPaths(paths: string[]): void;
  setProjectSkillPaths(paths: string[]): void;
  setProjectPromptTemplatePaths(paths: string[]): void;
  setProjectThemePaths(paths: string[]): void;
  setPackages(packages: PiPackageEntry[]): void;
  setProjectPackages(packages: PiPackageEntry[]): void;
  flush(): Promise<void>;
}

/** Subset of pi's `PackageManager` used to read activation state. */
export interface PiPackageManager {
  resolve(onMissing?: (source: string) => Promise<"install" | "skip" | "error">): Promise<ResolvedPaths>;
}

export interface PiModule {
  DefaultPackageManager: new (opts: {
    cwd: string;
    agentDir: string;
    settingsManager: PiSettingsManager;
  }) => PiPackageManager;
  SettingsManager: {
    create(cwd: string, agentDir?: string, options?: { projectTrusted?: boolean }): PiSettingsManager;
  };
}

export const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");

async function loadPi(registry: ToolRegistry): Promise<PiModule> {
  const { module } = await registry.resolveModule<PiModule>("pi-coding-agent");
  return module;
}

/** Load pi's core writer + resolver classes (SettingsManager, DefaultPackageManager). */
export async function getPiCore(registry: ToolRegistry = getDefaultRegistry()): Promise<PiModule> {
  return loadPi(registry);
}

/**
 * Resolve the activation state for a cwd via pi's `PackageManager.resolve()`.
 * Returns `null` if pi is unavailable or resolution throws — callers then
 * default every resource to `enabled: true`. `onMissing` returns "skip" so a
 * missing package source never triggers an install or throws.
 */
export type ResolveActivationFn = (cwd: string, agentDir?: string) => Promise<ResolvedPaths | null>;

export const resolveActivation: ResolveActivationFn = async (cwd, agentDir = AGENT_DIR) => {
  try {
    const { DefaultPackageManager, SettingsManager } = await getPiCore();
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
    const pm = new DefaultPackageManager({ cwd, agentDir, settingsManager });
    return (await pm.resolve(async () => "skip")) as ResolvedPaths;
  } catch {
    return null;
  }
};

function realpathOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Flatten a `ResolvedPaths` into a `path → enabled` lookup across all four
 * resource arrays, keyed by both the raw and realpath-normalized path so a
 * scanner path that differs only by symlink resolution still matches.
 */
export function buildEnabledMap(resolved: ResolvedPaths): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const key of ["extensions", "skills", "prompts", "themes"] as const) {
    for (const r of resolved[key] ?? []) {
      map.set(r.path, r.enabled);
      map.set(realpathOr(r.path), r.enabled);
    }
  }
  return map;
}

/** Look up a scanned resource's enabled flag; defaults to `true` when pi reports nothing. */
export function lookupEnabled(map: Map<string, boolean>, filePath: string): boolean {
  if (map.has(filePath)) return map.get(filePath) as boolean;
  const real = realpathOr(filePath);
  if (map.has(real)) return map.get(real) as boolean;
  return true;
}
