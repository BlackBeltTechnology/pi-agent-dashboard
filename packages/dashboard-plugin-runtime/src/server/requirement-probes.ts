/**
 * Declarative requirement probes for the Plugins activation UI.
 *
 * A plugin manifest may declare `requires: { piExtensions?, binaries?, services? }`.
 * `runRequirementProbes` answers each declared requirement against the existing
 * infrastructure:
 *   - piExtensions → caller-supplied `listInstalled()` (reuses pi's package
 *     manager via `packageManagerWrapper.listInstalled("global")` in the
 *     running server; injected as a dep so this package doesn't depend on
 *     the server package).
 *   - binaries     → caller-supplied tool registry (reuses the shared
 *     `ToolRegistry` instance from `@blackbelt-technology/pi-dashboard-shared`).
 *   - services     → closed built-in registry; in V1 only `pi-model-proxy`
 *     is recognised.
 *
 * Reports are cached for 30 seconds per plugin id to keep the cost low when
 * `/api/health` is fetched repeatedly.
 *
 * See change: add-plugin-activation-ui (Layer 1.5).
 */
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import type {
  PluginManifest,
  PluginRequirements,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import type { PluginRequirementReport } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/plugin-status.js";
import { sourcesMatch } from "@blackbelt-technology/pi-dashboard-shared/source-matching.js";
import { probePiModelProxy } from "./service-probes/pi-model-proxy.js";

/** Minimal installed-package record we read for the piExtensions probe. */
export interface InstalledPackageRecord {
  source?: string;
  name?: string;
  id?: string;
  displayName?: string;
}

/** Minimal tool-registry shape; satisfied by the shared `ToolRegistry`. */
export interface ToolRegistryLike {
  resolve(name: string): { ok: boolean; resolvedPath?: string };
}

export interface RequirementProbeDeps {
  /**
   * Lists pi extensions installed in the "global" scope. The runtime hands
   * in a callback that delegates to `packageManagerWrapper.listInstalled("global")`
   * so this module stays free of any server-package dependency.
   */
  listInstalled?: () => Promise<InstalledPackageRecord[]>;
  /** Optional tool registry adaptor for binary probes. */
  toolRegistry?: ToolRegistryLike;
  /** Optional fetch impl for service probes (tests inject). */
  fetchImpl?: typeof fetch;
  /**
   * Declaring plugin's validated config (schema defaults already applied),
   * used to resolve a `${configKey}` placeholder in a `paths` requirement.
   * See change: add-apple-tools-imcp-plugin.
   */
  pluginConfig?: Record<string, unknown>;
  /**
   * Keys declared in the plugin's `configSchema`. A `${configKey}` naming a
   * key absent from this set is unsatisfied (never a throw). When omitted,
   * the key-existence guard is skipped (bare-requires callers with no schema).
   */
  configSchemaKeys?: readonly string[];
  /** Injectable existence check for `paths` probes (tests inject; defaults to fs.existsSync). */
  pathExists?: (p: string) => boolean;
}

/** A `paths` entry may be exactly one `${configKey}` placeholder. */
const CONFIG_PLACEHOLDER = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

const KNOWN_SERVICES: Record<
  string,
  (deps: RequirementProbeDeps) => Promise<{ satisfied: boolean; error?: string }>
> = {
  "pi-model-proxy": (deps) => probePiModelProxy({ fetchImpl: deps.fetchImpl }),
};

/** Match an installed entry to a requirement name. Reuses the recommended-extensions matcher. */
function installedMatchesName(installed: InstalledPackageRecord, name: string): boolean {
  if (!installed) return false;
  if (installed.id === name) return true;
  if (installed.name === name) return true;
  if (installed.displayName === name) return true;
  if (typeof installed.source === "string") {
    if (installed.source === name) return true;
    if (installed.source === `npm:${name}`) return true;
    if (sourcesMatch(installed.source, name)) return true;
    if (sourcesMatch(installed.source, `npm:${name}`)) return true;
  }
  return false;
}

export async function probePiExtension(
  name: string,
  deps: RequirementProbeDeps,
): Promise<{ name: string; satisfied: boolean }> {
  if (!deps.listInstalled) return { name, satisfied: false };
  try {
    const list = await deps.listInstalled();
    const found = list.some((p) => installedMatchesName(p, name));
    return { name, satisfied: found };
  } catch {
    return { name, satisfied: false };
  }
}

export function probeBinary(
  name: string,
  deps: RequirementProbeDeps,
): { name: string; satisfied: boolean; resolvedPath?: string } {
  if (!deps.toolRegistry) return { name, satisfied: false };
  try {
    const r = deps.toolRegistry.resolve(name);
    if (r.ok) return { name, satisfied: true, resolvedPath: r.resolvedPath };
    return { name, satisfied: false };
  } catch {
    return { name, satisfied: false };
  }
}

/**
 * Probe a single `paths` requirement: an existence check on an absolute path,
 * with optional `${configKey}` interpolation against the plugin's validated
 * config. Never executes the path, never follows into it, never builds a shell
 * string from it. A relative path, an unresolved/absent config key, or a
 * non-absolute resolved value yields `satisfied: false` — never a throw.
 * See change: add-apple-tools-imcp-plugin.
 */
export function probePath(
  rawPath: string,
  deps: RequirementProbeDeps,
): { name: string; satisfied: boolean } {
  const exists = deps.pathExists ?? existsSync;
  const m = CONFIG_PLACEHOLDER.exec(rawPath);
  let resolved = rawPath;
  if (m) {
    const key = m[1];
    if (deps.configSchemaKeys && !deps.configSchemaKeys.includes(key)) {
      return { name: rawPath, satisfied: false };
    }
    const val = deps.pluginConfig?.[key];
    if (typeof val !== "string" || !isAbsolute(val)) {
      return { name: rawPath, satisfied: false };
    }
    resolved = val;
  } else if (!isAbsolute(rawPath)) {
    return { name: rawPath, satisfied: false };
  }
  // On successful interpolation the resolved value is the legible name;
  // otherwise the declared path verbatim.
  const name = m ? resolved : rawPath;
  try {
    return { name, satisfied: exists(resolved) };
  } catch {
    return { name, satisfied: false };
  }
}

export async function probeService(
  name: string,
  deps: RequirementProbeDeps,
): Promise<{ name: string; satisfied: boolean; error?: string }> {
  const fn = KNOWN_SERVICES[name];
  if (!fn) {
    return { name, satisfied: false, error: "unknown service name" };
  }
  return { name, ...(await fn(deps)) };
}

/**
 * Probe a bare `PluginRequirements` (no manifest wrapper). Used by the
 * recommended-extensions enricher, which carries `requires` directly on each
 * RecommendedExtension. `runRequirementProbes` delegates here.
 * See change: align-pi-080-and-publish-baseline-packages (Piece A).
 */
export async function runRequirementProbesFor(
  requires: PluginRequirements | undefined,
  deps: RequirementProbeDeps,
): Promise<PluginRequirementReport> {
  const req: PluginRequirements = requires ?? {};
  const piExtNames = req.piExtensions ?? [];
  const binNames = req.binaries ?? [];
  const svcNames = req.services ?? [];

  const piExtensions = await Promise.all(
    piExtNames.map((n) => probePiExtension(n, deps)),
  );
  const binaries = binNames.map((n) => probeBinary(n, deps));
  const services = await Promise.all(svcNames.map((n) => probeService(n, deps)));
  const paths = (req.paths ?? []).map((p) => probePath(p, deps));

  return { piExtensions, binaries, services, paths };
}

export async function runRequirementProbes(
  manifest: PluginManifest,
  deps: RequirementProbeDeps,
): Promise<PluginRequirementReport> {
  return runRequirementProbesFor(manifest.requires, deps);
}

/** Flatten unsatisfied names from a probe report. */
export function missingFromReport(report: PluginRequirementReport): string[] {
  const out: string[] = [];
  for (const e of report.piExtensions) if (!e.satisfied) out.push(e.name);
  for (const e of report.binaries) if (!e.satisfied) out.push(e.name);
  for (const e of report.services) if (!e.satisfied) out.push(e.name);
  for (const e of report.paths) if (!e.satisfied) out.push(e.name);
  return out;
}

// ── 30s TTL cache keyed by plugin id ────────────────────────────────────────

interface CachedReport {
  report: PluginRequirementReport;
  at: number;
}

const TTL_MS = 30_000;
const cache = new Map<string, CachedReport>();

export function getCachedReport(pluginId: string, now: number = Date.now()): PluginRequirementReport | null {
  const entry = cache.get(pluginId);
  if (!entry) return null;
  if (now - entry.at > TTL_MS) return null;
  return entry.report;
}

export function setCachedReport(
  pluginId: string,
  report: PluginRequirementReport,
  now: number = Date.now(),
): void {
  cache.set(pluginId, { report, at: now });
}

export function clearRequirementCache(): void {
  cache.clear();
}
