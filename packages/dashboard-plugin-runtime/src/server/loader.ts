/**
 * Plugin loader: discovers manifests and loads server entries.
 *
 * Discovery globs packages/* /package.json (without space) once per process.
 * Both the Vite plugin and loadServerEntries share the discovery result
 * via a module-level cache.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import type { PluginManifest } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import type {
  PluginClientStatus,
  PluginDiscoverySource,
  PluginHostApiStatus,
  PluginShadowedCopy,
  PluginStatus,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/plugin-status.js";
import { listPiPackages } from "@blackbelt-technology/pi-dashboard-shared/pi-package-resolver.js";
import {
  buildGraph,
  detectCycles,
  topologicalSort,
  transitiveDependents,
} from "../dependency-graph.js";
import { validateManifest } from "../manifest-validator.js";
import { getFileValidatorRegistry } from "./file-validator-registry.js";
import { fixtureEntryAllowed } from "./fixture-gate.js";
import { evaluateHostApi } from "./host-api-gate.js";
import { createPluginStatusStore, type PluginStatusStore } from "./plugin-status-store.js";
import {
  missingFromReport,
  type RequirementProbeDeps,
  runRequirementProbes,
  setCachedReport,
} from "./requirement-probes.js";
import type { ServerPluginContext } from "./server-context.js";
import { getWsRouteRegistry } from "./ws-route-registry.js";

// ── Discovery cache ────────────────────────────────────────────────────────

export interface DiscoveredPlugin {
  manifest: PluginManifest;
  packageDir: string;
  /**
   * The npm package name from the plugin's package.json ("" when absent).
   * Identity signal for host trust gates that must not overload `priority`
   * (which doubles as slot render-order). See change: publish-quota-plugin.
   */
  packageName: string;
  /** Absolute path to the server entry (if declared and resolved). */
  serverEntryPath?: string;
  /** Absolute path to the bridge entry (if declared and resolved). */
  bridgeEntryPath?: string;
  /** Absolute path to the client entry (if declared and resolved). */
  clientEntryPath?: string;
  /** Search dir this plugin was discovered in. See change: decouple-plugins-from-core (D7). */
  source: PluginDiscoverySource;
  /** Host API range evaluation (absent when none declared or required). */
  hostApi?: PluginHostApiStatus;
  /**
   * Set (to a `host-api: …` message) when an `installed` / `pi-package` plugin's
   * `hostApi` is incompatible: its server entry is skipped and its client refused.
   */
  hostApiRefusal?: string;
  /**
   * Losing duplicates of this id (never loaded). One row per id.
   * See change: decouple-plugins-from-core (D15).
   */
  shadowed?: PluginShadowedCopy[];
}

/** Extra discovery dir with an explicit source (test/seam; production dirs are derived). */
export interface DiscoverySearchDir {
  dir: string;
  source: PluginDiscoverySource;
}

/** Discovery options. See change: decouple-plugins-from-core (D11, D15). */
export interface DiscoveryOptions {
  /**
   * Ids the served client build declares bundled (`pi-dashboard-build.json#bundledPluginIds`).
   * Overrides the process-wide declared ids (`setDeclaredBundledPluginIds`). Absent → "undeclared".
   */
  bundledPluginIds?: readonly string[];
  /**
   * The 4th, lowest-priority source: user-scope `settings.json#packages[]` packages carrying a
   * manifest. On by default when `repoRoot` is not given (production); with an explicit
   * `repoRoot` only when an object is passed (`agentDir` / `npmRoot` are test seams).
   * `false` disables it.
   */
  piPackages?: false | { agentDir?: string; npmRoot?: string };
}

/** Per-key discovery cache: effective root set + digest of declared bundled ids. */
const _discoveryCache = new Map<string, DiscoveredPlugin[]>();

/** Ids of the served build declaration, handed over by the server before any discovery call. */
let _declaredBundledIds: readonly string[] | undefined;

/** Set (or clear, with `undefined`) the served declaration's `bundledPluginIds`. */
export function setDeclaredBundledPluginIds(ids: readonly string[] | undefined): void {
  _declaredBundledIds = ids ? [...ids] : undefined;
}

export function getDeclaredBundledPluginIds(): readonly string[] | undefined {
  return _declaredBundledIds;
}

/** Digest of declared ids; absent → the fixed "undeclared" key. */
function idsDigest(ids: readonly string[] | undefined): string {
  if (!ids) return "undeclared";
  return crypto.createHash("sha1").update([...new Set(ids)].sort().join("\n")).digest("hex");
}

/** Source priority; declared ids prefer the copy the build was made from (workspace, then bundled). */
const PLAIN_RANK: Record<PluginDiscoverySource, number> = {
  workspace: 0,
  installed: 1,
  bundled: 2,
  "pi-package": 3,
  "local-detected": 4,
};
const DECLARED_RANK: Record<PluginDiscoverySource, number> = {
  workspace: 0,
  bundled: 1,
  installed: 2,
  "pi-package": 3,
  "local-detected": 4,
};

/**
 * Find the monorepo root by walking up from `import.meta.url` looking for
 * a `pnpm-workspace.yaml` or a `package.json` with a top-level `workspaces`
 * field. Returns the absolute path to the root if found, null otherwise.
 *
 * This survives wherever the dashboard-plugin-runtime package is installed:
 * inside the monorepo, in node_modules of an installed dashboard, or inside
 * Electron's bundled resources.
 */
export function findMonorepoRoot(startDir?: string): string | null {
  let dir = startDir ?? path.dirname(url.fileURLToPath(import.meta.url));
  const stop = path.parse(dir).root;
  while (dir !== stop) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const pkgJson = path.join(dir, "package.json");
    if (fs.existsSync(pkgJson)) {
      try {
        const raw = JSON.parse(fs.readFileSync(pkgJson, "utf-8")) as Record<string, unknown>;
        if (raw.workspaces) return dir;
      } catch {
        // continue walking up
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Return `~/.pi/dashboard/plugins/` if it exists; null otherwise.
 * This is where user-installed plugins live (per `add-plugin-activation-ui`).
 */
export function findInstalledPluginsDir(): string | null {
  const dir = path.join(os.homedir(), ".pi", "dashboard", "plugins");
  return fs.existsSync(dir) ? dir : null;
}

/**
 * Return the bundled-plugins directory shipped alongside the dashboard
 * server (Electron resources, npm-global install layout). Walks up from
 * `import.meta.url` to find `resources/plugins/` or equivalent.
 */
export function findBundledPluginsDir(): string | null {
  let dir = path.dirname(url.fileURLToPath(import.meta.url));
  const stop = path.parse(dir).root;
  while (dir !== stop) {
    const candidate = path.join(dir, "resources", "plugins");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Read + validate one candidate package dir; null (silently) when it carries no valid manifest. */
export function readPluginCandidate(pkgDir: string, source: PluginDiscoverySource): DiscoveredPlugin | null {
  const pkgJson = path.join(pkgDir, "package.json");
  if (!fs.existsSync(pkgJson)) return null;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(pkgJson, "utf-8"));
  } catch {
    return null;
  }

  // Check for adjacent dashboard-plugin.json (takes precedence)
  const adjacentJson = path.join(pkgDir, "dashboard-plugin.json");
  let manifestRaw: unknown = raw["pi-dashboard-plugin"];

  if (fs.existsSync(adjacentJson)) {
    if (manifestRaw !== undefined) {
      console.warn(
        `[plugin-loader] Both package.json#pi-dashboard-plugin and dashboard-plugin.json found in ${pkgDir}. Using dashboard-plugin.json.`,
      );
    }
    try {
      manifestRaw = JSON.parse(fs.readFileSync(adjacentJson, "utf-8"));
    } catch {
      return null;
    }
  }

  if (manifestRaw === undefined || manifestRaw === null) return null;

  let manifest: PluginManifest;
  try {
    manifest = validateManifest(manifestRaw);
  } catch (e) {
    console.error(`[plugin-loader] Validation failed for package at ${pkgDir}:`, e);
    return null;
  }

  const resolve = (rel: string | undefined) => (rel ? path.resolve(pkgDir, rel) : undefined);

  // One hostApi range gates both halves. `clientBundle` is read raw: the
  // validator learns the field in Phase 5. See change: decouple-plugins-from-core (D7).
  const verdict = evaluateHostApi({
    source,
    range: manifest.hostApi,
    hasClientBundle:
      typeof manifestRaw === "object" && typeof (manifestRaw as { clientBundle?: unknown }).clientBundle === "string",
  });
  if (verdict.warn) {
    console.warn(`[plugin-loader] Plugin "${manifest.id}" (${source}): ${verdict.reason}; loading anyway`);
  }

  return {
    manifest,
    source,
    ...(verdict.status ? { hostApi: verdict.status } : {}),
    ...(verdict.refuse ? { hostApiRefusal: verdict.reason } : {}),
    packageDir: pkgDir,
    packageName: typeof raw.name === "string" ? raw.name : "",
    serverEntryPath: resolve(manifest.server),
    bridgeEntryPath: resolve(manifest.bridge),
    clientEntryPath: resolve(manifest.client),
  };
}

function realOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** Candidates of one search dir (one level: `<dir>/<entry>/package.json`), alphabetical = deterministic. */
function scanSearchDir(dir: string, source: PluginDiscoverySource): DiscoveredPlugin[] {
  if (!fs.existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
  const out: DiscoveredPlugin[] = [];
  for (const entry of entries) {
    const candidate = readPluginCandidate(path.join(dir, entry), source);
    if (candidate) out.push(candidate);
  }
  return out;
}

/**
 * Pick one winner per id; losers become the winner's `shadowed` (warn-logged, never loaded).
 * Plain priority is workspace > installed > bundled > pi-package; for an id the served build
 * declares bundled, the copy the build was made from wins (workspace, else bundled), then plain
 * priority. See change: decouple-plugins-from-core (D11, D15).
 */
function pickWinners(candidates: DiscoveredPlugin[], declared: ReadonlySet<string>): DiscoveredPlugin[] {
  const byId = new Map<string, DiscoveredPlugin[]>();
  for (const c of candidates) {
    const list = byId.get(c.manifest.id);
    if (list) list.push(c);
    else byId.set(c.manifest.id, [c]);
  }
  const winners: DiscoveredPlugin[] = [];
  for (const [id, list] of byId) {
    const rank = declared.has(id) ? DECLARED_RANK : PLAIN_RANK;
    // Array.prototype.sort is stable: equal ranks keep discovery order (search-dir order, alphabetical).
    const ordered = [...list].sort((a, b) => rank[a.source] - rank[b.source]);
    const [winner, ...losers] = ordered;
    const winnerReal = realOrSelf(winner.packageDir);
    const shadowed: PluginShadowedCopy[] = [];
    for (const loser of losers) {
      // The same directory reached through two sources (e.g. a pi-package entry pointing at a workspace dir).
      if (realOrSelf(loser.packageDir) === winnerReal) continue;
      shadowed.push({ source: loser.source, packageDir: loser.packageDir });
      console.warn(
        `[plugin-loader] Plugin "${id}": ${winner.source} copy at ${winner.packageDir} shadows ${loser.source} copy at ${loser.packageDir}`,
      );
    }
    winners.push(shadowed.length > 0 ? { ...winner, shadowed } : winner);
  }
  return winners;
}

/**
 * Discover plugin manifests from the monorepo, user-installed plugins,
 * bundled-resources plugins and `settings.json#packages[]` packages
 * (in that priority order; one winner per id, losers recorded as `shadowed`).
 *
 * Results are cached per effective root set + digest of the served declaration's
 * `bundledPluginIds`; each key globs once until `clearDiscoveryCache()`. Pass an
 * explicit `repoRoot` to force discovery from a specific directory (useful for tests).
 */
export function discoverPlugins(
  repoRoot?: string,
  extraSearchDirs: readonly DiscoverySearchDir[] = [],
  opts: DiscoveryOptions = {},
): DiscoveredPlugin[] {
  const searchDirs: DiscoverySearchDir[] = [];

  if (repoRoot) {
    // Explicit override (test or build-time call site): keep legacy behaviour.
    searchDirs.push({ dir: path.join(repoRoot, "packages"), source: "workspace" });
    searchDirs.push(...extraSearchDirs);
  } else {
    const monorepo = findMonorepoRoot();
    if (monorepo) searchDirs.push({ dir: path.join(monorepo, "packages"), source: "workspace" });
    const installed = findInstalledPluginsDir();
    if (installed) searchDirs.push({ dir: installed, source: "installed" });
    const bundled = findBundledPluginsDir();
    if (bundled) searchDirs.push({ dir: bundled, source: "bundled" });
  }

  const piOpts = opts.piPackages === false ? null : (opts.piPackages ?? (repoRoot ? null : {}));
  const declaredIds = opts.bundledPluginIds ?? _declaredBundledIds;
  const cacheKey = JSON.stringify([
    searchDirs.map((d) => [d.source, d.dir]),
    piOpts ? [piOpts.agentDir ?? "", piOpts.npmRoot ?? ""] : null,
    idsDigest(declaredIds),
  ]);
  const cached = _discoveryCache.get(cacheKey);
  if (cached) return cached;

  const candidates: DiscoveredPlugin[] = [];
  for (const { dir, source } of searchDirs) candidates.push(...scanSearchDir(dir, source));

  // 4th, lowest-priority source: user-scope pi packages. Entries that resolve to a file or to a
  // directory without a manifest are skipped silently (the resolver omits missing ones and warns
  // only when settings.json cannot be read). See change: decouple-plugins-from-core (D15).
  if (piOpts) {
    for (const pkg of listPiPackages({ scope: "user", ...piOpts })) {
      const candidate = readPluginCandidate(pkg.packageDir, "pi-package");
      if (candidate) candidates.push(candidate);
    }
  }

  const results = pickWinners(candidates, new Set(declaredIds ?? []));

  // Sort by (priority asc, id asc)
  results.sort((a, b) => {
    const pa = a.manifest.priority ?? 1000;
    const pb = b.manifest.priority ?? 1000;
    if (pa !== pb) return pa - pb;
    return a.manifest.id.localeCompare(b.manifest.id);
  });

  console.log(
    `[plugin-loader] discovered ${results.length} plugin(s): ${results
      .map((p) => p.manifest.id)
      .join(", ") || "(none)"}`,
  );

  _discoveryCache.set(cacheKey, results);
  return results;
}

/** Discovery-derived `PluginStatus` fields: source, shadowed copies, host API evaluation, client refusal. */
export function discoveryFields(plugin: DiscoveredPlugin): Pick<PluginStatus, "source" | "hostApi" | "client" | "shadowed"> {
  const client: PluginClientStatus | undefined = plugin.hostApiRefusal
    ? { delivery: "refused", refusedReason: "host-api" }
    : undefined;
  return {
    source: plugin.source,
    ...(plugin.shadowed?.length ? { shadowed: plugin.shadowed } : {}),
    ...(plugin.hostApi ? { hostApi: plugin.hostApi } : {}),
    ...(client ? { client } : {}),
  };
}

/** Clear every discovery cache key (tests, `refreshPluginDiscovery`, the vite plugin). */
export function clearDiscoveryCache(): void {
  _discoveryCache.clear();
}

// ── Status store singleton ─────────────────────────────────────────────────

let _statusStore: PluginStatusStore | null = null;

export function getPluginStatusStore(): PluginStatusStore {
  if (!_statusStore) _statusStore = createPluginStatusStore();
  return _statusStore;
}

// ── Registry hash (build- and runtime-shared) ──────────────────────

/**
 * Deterministic serialization of the discovered plugin set, used for
 * staleness detection. Sorts plugins by id, sorts claims by
 * (slot, component, predicate, command) lexicographically. Two
 * discoveries against the same plugin set produce the same string;
 * adding/removing a plugin or claim changes it.
 *
 * Shared between the vite-plugin (build-time) and the dashboard server
 * (runtime) so `PLUGIN_REGISTRY_HASH` and `/api/health.bundleHash`
 * compare apples-to-apples.
 *
 * See change: fix-pi-flows-end-to-end (Group 6).
 */
export function deterministicSerializePlugins(
  plugins: ReadonlyArray<{ manifest: PluginManifest }>,
): string {
  const plain = plugins
    .map((p) => ({
      id: p.manifest.id,
      version: (p.manifest as { version?: string }).version ?? null,
      claims: p.manifest.claims
        .map((c) => ({
          slot: c.slot,
          component: c.component ?? null,
          predicate: c.predicate ?? null,
          shouldRender: c.shouldRender ?? null,
          command: c.command ?? null,
          tab: c.tab ?? null,
          toolName: c.toolName ?? null,
          // First-class shell-overlay-route fields. See change:
          // fix-flows-plugin-polish (path-as-first-class-claim-field).
          path: c.path ?? null,
          sessionParam: c.sessionParam ?? null,
          // settings-section nav promotion hint: a nav-only manifest edit must
          // invalidate the registry hash. See change: promote-model-roles-settings.
          nav: c.nav ?? null,
          // Generic config escape hatch — included so any plugin using it
          // for slot-specific extras participates in staleness detection.
          config: c.config ?? null,
          // editor-pane-tab prefix + label: a prefix- or label-only edit must
          // change the hash. Spread only when present so every other plugin's
          // serialization (and hash) is unchanged. See change: add-browser-editor-pane-tab.
          ...(c.pathPrefix !== undefined ? { pathPrefix: c.pathPrefix } : {}),
          ...(c.labelComponent !== undefined ? { labelComponent: c.labelComponent } : {}),
          // resource-page-section page filter. See change: add-skill-atlas-screen.
          ...(c.resourceType !== undefined ? { resourceType: c.resourceType } : {}),
          // Lazy component module: a module-only edit must change the hash.
          // See change: lazy-plugin-claim-modules.
          ...(c.module !== undefined ? { module: c.module } : {}),
          // editor-pane-file-handler fields: any single-field edit must change
          // the hash; spread-when-present so other plugins' hashes are
          // unchanged. See change: add-editor-pane-file-handlers.
          ...(c.id !== undefined ? { id: c.id } : {}),
          ...(c.extensions !== undefined ? { extensions: c.extensions } : {}),
          ...(c.mode !== undefined ? { mode: c.mode } : {}),
          ...(c.label !== undefined ? { label: c.label } : {}),
          ...(c.keepAlive !== undefined ? { keepAlive: c.keepAlive } : {}),
          ...(c.maxBytes !== undefined ? { maxBytes: c.maxBytes } : {}),
          ...(c.firstOverwriteNotice !== undefined ? { firstOverwriteNotice: c.firstOverwriteNotice } : {}),
          ...(c.copySuffix !== undefined ? { copySuffix: c.copySuffix } : {}),
          ...(c.validator !== undefined ? { validator: c.validator } : {}),
        }))
        .sort((a, b) =>
          [a.slot, a.component, a.predicate, a.command, a.path]
            .map((x) => x ?? "")
            .join("\0")
            .localeCompare(
              [b.slot, b.component, b.predicate, b.command, b.path]
                .map((x) => x ?? "")
                .join("\0"),
            ),
        ),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(plain);
}

/** SHA-256 hex digest of the deterministic registry serialization. */
export function pluginRegistryHash(
  plugins: ReadonlyArray<{ manifest: PluginManifest }>,
): string {
  return crypto
    .createHash("sha256")
    .update(deterministicSerializePlugins(plugins))
    .digest("hex");
}

/** Reset the status store (for testing). */
export function clearStatusStore(): void {
  _statusStore = null;
}

// ── Server-side loader ─────────────────────────────────────────────────────

export interface ServerLoadDeps {
  /** Factory that creates a ServerPluginContext for a specific plugin. */
  createContext: (plugin: DiscoveredPlugin) => ServerPluginContext;
  /** Config accessor: is this plugin enabled? */
  isEnabled: (pluginId: string) => boolean;
  /** Repo root for discovery (defaults to cwd). */
  repoRoot?: string;
  /**
   * Optional probe dependencies. When provided, the loader runs declarative
   * requirement probes for each plugin (fire-and-forget; does not affect
   * `loaded`) and writes the result into the status store.
   * See change: add-plugin-activation-ui.
   */
  requirementDeps?: RequirementProbeDeps;
  /**
   * Optional per-plugin config accessor. Supplies the validated config a
   * `requires.paths` `${configKey}` placeholder resolves against. When absent,
   * a placeholder falls back to the plugin's `configSchema` default.
   * See change: add-apple-tools-imcp-plugin.
   */
  getPluginConfig?: (pluginId: string) => Record<string, unknown>;
  /**
   * Operator server-trust predicate for a `pi-package` winner (design D12, R9). Default-deny:
   * absent → every `pi-package` server entry / bridge stays refused (`server-untrusted`).
   * `workspace` / `bundled` / `installed` are never asked.
   */
  isServerTrusted?: (plugin: DiscoveredPlugin) => boolean;
  /**
   * Additive mode (`refreshPluginDiscovery`): only these ids are (re)evaluated and loaded;
   * every other discovered plugin keeps its status row untouched. Absent → all plugins.
   */
  onlyIds?: ReadonlySet<string>;
  /** Extra discovery dirs + options forwarded to `discoverPlugins` (test seam; production derives its roots). */
  discovery?: { extraSearchDirs?: readonly DiscoverySearchDir[] } & DiscoveryOptions;
}

/** `discoverPlugins` as the loader deps describe it (shared by the boot pass and refresh). */
export function discoverForDeps(deps: Pick<ServerLoadDeps, "repoRoot" | "discovery">): DiscoveredPlugin[] {
  const { extraSearchDirs, ...opts } = deps.discovery ?? {};
  return discoverPlugins(deps.repoRoot, extraSearchDirs ?? [], opts);
}

/** Error text of a `pi-package` plugin whose server entry / bridge the operator has not trusted. */
export const SERVER_UNTRUSTED_ERROR = "server-untrusted";

/** Whether a plugin's server entry / bridge may be loaded: only a `pi-package` winner needs operator trust. */
export function pluginServerAllowed(
  plugin: DiscoveredPlugin,
  isServerTrusted?: (plugin: DiscoveredPlugin) => boolean,
): boolean {
  if (plugin.source !== "pi-package") return true;
  return isServerTrusted?.(plugin) === true;
}

/**
 * What a loaded plugin looked like when its server entry ran. `refreshPluginDiscovery` compares
 * the current discovery against it to flag `restartRequired` (package changed or vanished).
 */
interface LoadedSnapshot {
  packageDir: string;
  fingerprint: string;
}
const _loadedSnapshots = new Map<string, LoadedSnapshot>();

function packageFingerprint(plugin: DiscoveredPlugin): string {
  let version = "";
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(plugin.packageDir, "package.json"), "utf-8")) as { version?: unknown };
    if (typeof raw.version === "string") version = raw.version;
  } catch {
    /* unreadable → empty version */
  }
  let entry = "";
  if (plugin.serverEntryPath) {
    try {
      const st = fs.statSync(plugin.serverEntryPath);
      entry = `${st.size}:${st.mtimeMs}`;
    } catch {
      /* missing entry */
    }
  }
  return `${version}|${entry}`;
}

function recordLoaded(plugin: DiscoveredPlugin): void {
  _loadedSnapshots.set(plugin.manifest.id, { packageDir: plugin.packageDir, fingerprint: packageFingerprint(plugin) });
}

/** Snapshot ids loaded this process (test/inspection seam). */
export function getLoadedSnapshotIds(): string[] {
  return [..._loadedSnapshots.keys()];
}

/** Compare a rediscovered plugin to what is loaded: did its package change? */
export function loadedPackageChanged(plugin: DiscoveredPlugin): boolean {
  const snap = _loadedSnapshots.get(plugin.manifest.id);
  if (!snap) return false;
  return snap.packageDir !== plugin.packageDir || snap.fingerprint !== packageFingerprint(plugin);
}

/** Whether this id's server side ran in this process (snapshot exists). */
export function wasLoadedThisProcess(id: string): boolean {
  return _loadedSnapshots.has(id);
}

/** Forget load snapshots (tests). */
export function clearLoadedSnapshots(): void {
  _loadedSnapshots.clear();
}

/**
 * Discover plugins and load each enabled plugin's server entry.
 * Awaits each plugin's registerPlugin() before proceeding.
 * Plugin failures are caught, logged, and reflected in the status store.
 */
export async function loadServerEntries(deps: ServerLoadDeps): Promise<void> {
  const store = getPluginStatusStore();
  const plugins = discoverForDeps(deps);

  // ---- Build dependency graph + soft-fail cycles ----------------------
  // See change: add-plugin-activation-ui (Layer 2 — dependency graph).
  const manifestSpecs = plugins.map((p) => ({
    id: p.manifest.id,
    dependsOn: p.manifest.dependsOn ?? [],
    priority: p.manifest.priority,
  }));
  const graph = buildGraph(manifestSpecs, deps.isEnabled);
  const cycles = detectCycles(graph);
  const cycleErrorById = new Map<string, string>();
  for (const cycle of cycles) {
    // cycle ends with the start id repeated, e.g. [a, b, a].
    const label = cycle.join("→");
    for (const id of cycle) cycleErrorById.set(id, `cycle: ${label}`);
  }

  // Topological order so deps are attempted before dependents.
  const orderedIds = topologicalSort(manifestSpecs);
  const orderedPlugins = orderedIds
    .map((id) => plugins.find((p) => p.manifest.id === id))
    .filter((p): p is DiscoveredPlugin => Boolean(p));

  // Inverse-dependents map (computed once, surfaced via PluginStatus.dependents).
  const dependentsById = new Map<string, string[]>();
  for (const id of graph.keys()) {
    dependentsById.set(id, Array.from(transitiveDependents(graph, id)).sort());
  }

  // The set of plugin ids that successfully loaded in this pass; consulted
  // by subsequent plugins' dep-validation step.
  const loadedIds = new Set<string>();
  // Additive pass: ids loaded by an earlier pass still satisfy dependents' dep-validation.
  if (deps.onlyIds) {
    for (const s of store.listAll()) if (s.loaded) loadedIds.add(s.id);
  }

  for (const plugin of orderedPlugins) {
    const { manifest } = plugin;
    if (deps.onlyIds && !deps.onlyIds.has(manifest.id)) continue;
    const enabled = deps.isEnabled(manifest.id);
    const dependsOn = manifest.dependsOn ?? [];
    const dependents = dependentsById.get(manifest.id) ?? [];
    const cycleError = cycleErrorById.get(manifest.id);

    // ---- Host API gate: installed / pi-package plugins built for another
    // host API load neither half. See change: decouple-plugins-from-core (D7).
    if (plugin.hostApiRefusal) {
      store.setStatus({
        id: manifest.id,
        displayName: manifest.displayName,
        enabled,
        loaded: false,
        error: plugin.hostApiRefusal,
        claims: manifest.claims.length,
        ...discoveryFields(plugin),
        dependsOn,
        dependents,
      });
      console.error(`[plugin-loader] Refusing plugin "${manifest.id}" — ${plugin.hostApiRefusal}`);
      continue;
    }

    // ---- Cycle soft-fail ---------------------------------------------
    if (cycleError) {
      store.setStatus({
        id: manifest.id,
        displayName: manifest.displayName,
        enabled,
        loaded: false,
        error: cycleError,
        claims: manifest.claims.length,
        ...discoveryFields(plugin),
        dependsOn,
        dependents,
      });
      console.error(`[plugin-loader] Skipping plugin "${manifest.id}" — ${cycleError}`);
      continue;
    }

    // ---- Dep validation (only when this plugin is itself enabled) ----
    if (enabled && dependsOn.length > 0) {
      const missingDeps: string[] = [];
      for (const depId of dependsOn) {
        const depNode = graph.get(depId);
        if (!depNode) missingDeps.push(depId);
        else if (!depNode.enabled || !loadedIds.has(depId)) missingDeps.push(depId);
      }
      if (missingDeps.length > 0) {
        store.setStatus({
          id: manifest.id,
          displayName: manifest.displayName,
          enabled,
          loaded: false,
          error: `missing/disabled dep: ${missingDeps.join(", ")}`,
          claims: manifest.claims.length,
          ...discoveryFields(plugin),
          dependsOn,
          dependents,
          missingDeps,
        });
        console.warn(
          `[plugin-loader] Skipping plugin "${manifest.id}" — missing/disabled dep: ${missingDeps.join(", ")}`,
        );
        continue;
      }
    }

    if (!enabled) {
      // Loader-level disable (toggle off): tear down any WS routes the
      // plugin's last activation registered — a disabled plugin's prefixes
      // must not stay live (spec add-browser-relay / plugin-ws-route). No-op
      // for a plugin that owns none.
      getWsRouteRegistry().teardownPlugin(manifest.id);
      getFileValidatorRegistry().unregisterPlugin(manifest.id);
      store.setStatus({
        id: manifest.id,
        displayName: manifest.displayName,
        enabled: false,
        loaded: false,
        claims: manifest.claims.length,
        ...discoveryFields(plugin),
        dependsOn,
        dependents,
      });
      continue;
    }

    // ---- Server trust: a `pi-package` winner's server entry and bridge are default-deny
    // until the local operator grants trust. See change: decouple-plugins-from-core (D12, R9).
    if (
      (plugin.serverEntryPath || plugin.bridgeEntryPath) &&
      !pluginServerAllowed(plugin, deps.isServerTrusted)
    ) {
      store.setStatus({
        id: manifest.id,
        displayName: manifest.displayName,
        enabled: true,
        loaded: false,
        error: SERVER_UNTRUSTED_ERROR,
        claims: manifest.claims.length,
        ...discoveryFields(plugin),
        dependsOn,
        dependents,
      });
      console.warn(
        `[plugin-loader] Refusing server entry of "${manifest.id}" (pi-package at ${plugin.packageDir}): ${SERVER_UNTRUSTED_ERROR}`,
      );
      continue;
    }

    // A fixture plugin's server entry loads only under the opt-in gate; without
    // it the plugin behaves as client-only. See change:
    // expose-plugin-credential-and-oauth-seams (D8).
    if (!plugin.serverEntryPath || !fixtureEntryAllowed(manifest)) {
      // No server entry — still mark as loaded (client-only plugin)
      store.setStatus({
        id: manifest.id,
        displayName: manifest.displayName,
        enabled: true,
        loaded: true,
        claims: manifest.claims.length,
        ...discoveryFields(plugin),
        dependsOn,
        dependents,
      });
      loadedIds.add(manifest.id);
      recordLoaded(plugin);
      continue;
    }

    // A re-activation pass starts from a clean validator set (stale entries from a
    // previous activation must not satisfy the fail-closed check).
    getFileValidatorRegistry().unregisterPlugin(manifest.id);
    const ctx = deps.createContext(plugin);
    // Open the plugin's WS-route activation window around its server entry:
    // `ctx.registerWsRoute` succeeds only inside this window (spec
    // add-browser-relay / plugin-ws-route). Re-activation (toggle off → on,
    // next loadServerEntries pass) opens a fresh window so the plugin
    // registers again.
    getWsRouteRegistry().beginActivation(manifest.id);
    try {
      // By file:// URL, never the raw path: native ESM rejects a raw Windows
      // `D:\…` specifier and parses a raw path as a URL everywhere (a `#` in
      // a directory becomes a fragment).
      // See change: fix-appimage-cold-boot-latency.
      const mod = await import(url.pathToFileURL(plugin.serverEntryPath).href);
      if (typeof mod.default !== "function") {
        throw new Error(`Server entry at ${plugin.serverEntryPath} has no default export function`);
      }
      await mod.default(ctx);
      getWsRouteRegistry().endActivation(manifest.id);
      store.setStatus({
        id: manifest.id,
        displayName: manifest.displayName,
        enabled: true,
        loaded: true,
        claims: manifest.claims.length,
        ...discoveryFields(plugin),
        dependsOn,
        dependents,
      });
      loadedIds.add(manifest.id);
      recordLoaded(plugin);
      console.info(`[plugin-loader] Loaded plugin "${manifest.id}"`);
    } catch (e) {
      // A failed activation must not leave its WS routes live (spec
      // add-browser-relay / plugin-ws-route: disable OR failure tears down).
      getWsRouteRegistry().teardownPlugin(manifest.id);
      getFileValidatorRegistry().unregisterPlugin(manifest.id);
      const msg = e instanceof Error ? e.message : String(e);
      store.setStatus({
        id: manifest.id,
        displayName: manifest.displayName,
        enabled: true,
        loaded: false,
        error: msg,
        claims: manifest.claims.length,
        ...discoveryFields(plugin),
        dependsOn,
        dependents,
      });
      console.error(`[plugin-loader] Failed to load plugin "${manifest.id}": ${msg}`);
    }
  }

  // Fire-and-forget requirement probes. Loader does NOT block on these; a
  // plugin whose requirements are unsatisfied is still "loaded" from the
  // loader's perspective — the UI surfaces the missing pieces and offers
  // an inline install. See change: add-plugin-activation-ui.
  if (deps.requirementDeps) {
    void refreshRequirementProbesFor(plugins, deps.requirementDeps, deps.getPluginConfig);
  }
}

/**
 * Walk the discovered plugin set, probe each plugin's declarative
 * `requires`, and update the status store. Idempotent; safe to call
 * repeatedly. Exported so the server can re-run probes after a successful
 * package_operation_complete broadcast.
 *
 * Returns a list of plugin ids whose `missingRequirements` actually changed
 * between the previous and new report, so the caller can broadcast
 * targeted `plugin_config_update` messages for them.
 *
 * See change: add-plugin-activation-ui.
 */
/**
 * Read a plugin's `configSchema` and return `{ keys, defaults }`. Used to
 * resolve a `requires.paths` `${configKey}` placeholder on a host that has
 * never written the key (schema default is the effective value).
 * See change: add-apple-tools-imcp-plugin.
 */
function readConfigSchema(plugin: DiscoveredPlugin): {
  keys: string[];
  defaults: Record<string, unknown>;
} {
  const rel = plugin.manifest.configSchema;
  if (!rel) return { keys: [], defaults: {} };
  try {
    const abs = path.resolve(plugin.packageDir, rel);
    const schema = JSON.parse(fs.readFileSync(abs, "utf8")) as {
      properties?: Record<string, { default?: unknown }>;
    };
    const props = schema.properties ?? {};
    const defaults: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      if (v && typeof v === "object" && "default" in v) defaults[k] = v.default;
    }
    return { keys: Object.keys(props), defaults };
  } catch {
    return { keys: [], defaults: {} };
  }
}

/**
 * Walk the discovered plugin set, probe each plugin's declarative `requires`,
 * and update the status store. Idempotent; safe to call repeatedly.
 *
 * Returns the plugin ids whose `missingRequirements` changed, so the caller can
 * broadcast targeted `plugin_config_update` messages.
 *
 * See change: add-plugin-activation-ui.
 */
export async function refreshRequirementProbesFor(
  pluginsOverride: DiscoveredPlugin[] | null,
  reqDeps: RequirementProbeDeps,
  getPluginConfig?: (pluginId: string) => Record<string, unknown>,
): Promise<string[]> {
  const plugins = pluginsOverride ?? discoverPlugins();
  const store = getPluginStatusStore();
  const changed: string[] = [];

  await Promise.all(
    plugins.map(async (plugin) => {
      const { manifest } = plugin;
      try {
        // Resolve the per-plugin config a `requires.paths` ${configKey}
        // placeholder interpolates: schema defaults overlaid with stored
        // config. See change: add-apple-tools-imcp-plugin.
        const { keys, defaults } = readConfigSchema(plugin);
        const stored = getPluginConfig?.(manifest.id) ?? {};
        const perPluginDeps: RequirementProbeDeps = {
          ...reqDeps,
          pluginConfig: { ...defaults, ...stored },
          configSchemaKeys: keys,
        };
        const report = await runRequirementProbes(manifest, perPluginDeps);
        const missing = missingFromReport(report);
        setCachedReport(manifest.id, report);
        const existing = store.getStatus(manifest.id);
        const prevMissing = existing?.missingRequirements ?? [];
        const missingChanged =
          prevMissing.length !== missing.length ||
          prevMissing.some((n) => !missing.includes(n)) ||
          missing.some((n) => !prevMissing.includes(n));
        store.setStatus({
          id: manifest.id,
          displayName: manifest.displayName,
          enabled: existing?.enabled ?? true,
          loaded: existing?.loaded ?? true,
          claims: manifest.claims.length,
          ...discoveryFields(plugin),
          ...(existing?.error ? { error: existing.error } : {}),
          requirements: report,
          missingRequirements: missing,
        });
        if (missingChanged) changed.push(manifest.id);
      } catch (e) {
        console.warn(
          `[plugin-loader] requirement probe failed for plugin "${manifest.id}":`,
          e,
        );
      }
    }),
  );

  return changed;
}
