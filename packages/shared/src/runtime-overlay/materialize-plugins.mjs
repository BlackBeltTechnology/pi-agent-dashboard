/**
 * First-party plugin materialization — ONE list, ONE copy routine.
 *
 * `packages/server/package.json#piDashboard.bundledPlugins` declares the
 * first-party plugin ids (monorepo package dir names). Both the Electron
 * bundle (`bundle-server.mjs`) and a staged runtime overlay copy exactly those
 * into `<runtime>/resources/plugins/<id>/`, where `findBundledPluginsDir()`
 * finds them by walking up from the plugin runtime.
 *
 * Plain ESM JavaScript (types in `materialize-plugins.d.mts`) so the build
 * script, which runs under plain Node, can import it.
 *
 * See change: electron-runtime-overlay-updates (D1, D2; test-plan E22).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Read `piDashboard.bundledPlugins` from a server package.json. Throws when
 * the field is missing or not a string array — a silent empty list would ship
 * a runtime with zero plugins.
 * @param {string} serverPackageJsonPath
 * @returns {string[]}
 */
export function readBundledPluginIds(serverPackageJsonPath) {
  const pkg = JSON.parse(readFileSync(serverPackageJsonPath, "utf8"));
  const ids = pkg?.piDashboard?.bundledPlugins;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string" && id !== "")) {
    throw new Error(
      `${serverPackageJsonPath}: piDashboard.bundledPlugins must be a non-empty string array`,
    );
  }
  return ids;
}

// Skip the package's OWN nested node_modules (pnpm store symlinks in the
// monorepo; nested deps in an overlay). Tested RELATIVE to the package dir:
// an overlay plugin itself lives under node_modules/. Split on both
// separators (NOT path.sep) so a Windows `\` path is handled on every host.
// See change: adopt-pnpm-for-dev-ci (design.md §D4), electron-runtime-overlay-updates.
const excludeNestedNodeModules = (/** @type {string} */ pkgDir) => (/** @type {string} */ src) =>
  !path.relative(pkgDir, src).split(/[\\/]/).includes("node_modules");

/**
 * Copy each declared plugin package into `destDir/<id>/`. Skips ids whose
 * source has no package.json and fixture plugins (`pi-dashboard-plugin.fixture
 * === true`). Returns the ids actually materialized, in declaration order.
 * @param {{ ids: string[], resolveSource: (id: string) => string | null, destDir: string }} opts
 * @returns {string[]}
 */
/**
 * The ONE plugin-source predicate shared by materialization and the dep
 * union, so the two can never drift: returns the parsed manifest of a
 * bundleable plugin, or null when the source is missing, has no / an
 * unparsable package.json, or is a fixture plugin.
 * @param {string | null} src
 * @returns {Record<string, any> | null}
 */
function readBundleablePluginManifest(src) {
  if (!src || !existsSync(path.join(src, "package.json"))) return null;
  try {
    const raw = JSON.parse(readFileSync(path.join(src, "package.json"), "utf8"));
    return raw?.["pi-dashboard-plugin"]?.fixture === true ? null : raw;
  } catch {
    return null; // unparsable manifest — skip defensively (pre-existing rule)
  }
}

export function materializeBundledPlugins({ ids, resolveSource, destDir }) {
  mkdirSync(destDir, { recursive: true });
  const done = [];
  for (const id of ids) {
    const src = resolveSource(id);
    if (!readBundleablePluginManifest(src)) continue;
    cpSync(src, path.join(destDir, id), {
      recursive: true,
      dereference: false,
      filter: excludeNestedNodeModules(src),
    });
    done.push(id);
  }
  return done;
}

const FIRST_PARTY_SCOPE = "@blackbelt-technology/";

/**
 * Union of the third-party `dependencies` of every bundleable plugin (same
 * id filter as `materializeBundledPlugins`). `peer`/`dev`/`optional` deps are
 * excluded. Every declaration of a collected name — across plugins AND the
 * bundle workspaces' manifests — must use the identical specifier string, and
 * a plugin specifier containing `:` or `/` (file:, workspace:, link:, git+…,
 * npm: aliases, user/repo) is rejected; both throw, failing the build loudly.
 * See change: bundle-plugin-third-party-deps (design D1, D3).
 * @param {{ ids: string[], resolveSource: (id: string) => string | null,
 *   workspaceManifests: { name: string, dependencies?: Record<string, string> }[] }} opts
 * @returns {Record<string, string>}
 */
export function collectPluginRuntimeDeps({ ids, resolveSource, workspaceManifests }) {
  /** @type {Map<string, { owner: string, spec: string }[]>} */
  const decls = new Map();
  for (const id of ids) {
    const manifest = readBundleablePluginManifest(resolveSource(id));
    if (!manifest) continue;
    for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
      if (name.startsWith(FIRST_PARTY_SCOPE)) continue;
      if (typeof spec !== "string" || /[:/]/.test(spec)) {
        throw new Error(
          `bundled plugin ${id}: dependency ${name}@${spec} uses a non-registry specifier — only semver ranges / dist-tags can be installed into the bundle`,
        );
      }
      if (!decls.has(name)) decls.set(name, []);
      decls.get(name).push({ owner: id, spec });
    }
  }
  for (const ws of workspaceManifests) {
    for (const [name, spec] of Object.entries(ws.dependencies ?? {})) {
      if (decls.has(name)) decls.get(name).push({ owner: ws.name, spec });
    }
  }
  const conflicts = [];
  /** @type {Record<string, string>} */
  const union = {};
  for (const [name, list] of [...decls.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (new Set(list.map((d) => d.spec)).size > 1) {
      conflicts.push(`${name}: ${list.map((d) => `${d.owner}@${d.spec}`).join(", ")}`);
      continue;
    }
    union[name] = list[0].spec;
  }
  if (conflicts.length > 0) {
    throw new Error(
      `bundled plugin dependency specifiers disagree (align them to one identical string):\n  ${conflicts.join("\n  ")}`,
    );
  }
  return union;
}

/**
 * Declared `dependencies` (first- AND third-party) of every
 * `pluginsDir/<id>/package.json` that no `node_modules/<name>/package.json`
 * provides on the walk from `pluginsDir/<id>` up to AND including `rootDir`.
 * Existence only (nothing executed; strict `exports` cannot hide the root
 * package.json). The `rootDir` bound keeps a stray ancestor `node_modules`
 * (monorepo, `~`) from producing a false green. Dirs without a manifest are
 * skipped. Sorted by plugin, then dep.
 * See change: bundle-plugin-third-party-deps (design D4).
 * @param {{ pluginsDir: string, rootDir: string }} opts
 * @returns {{ plugin: string, dep: string }[]}
 */
export function findUnresolvedPluginDeps({ pluginsDir, rootDir }) {
  const root = path.resolve(rootDir);
  const unresolved = [];
  const pluginIds = existsSync(pluginsDir)
    ? readdirSync(pluginsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];
  for (const id of pluginIds.sort()) {
    const pluginDir = path.resolve(pluginsDir, id);
    const manifestPath = path.join(pluginDir, "package.json");
    if (!existsSync(manifestPath)) continue;
    let deps;
    try {
      deps = JSON.parse(readFileSync(manifestPath, "utf8")).dependencies ?? {};
    } catch {
      continue;
    }
    for (const dep of Object.keys(deps).sort()) {
      if (!resolvesWithin(pluginDir, root, dep)) unresolved.push({ plugin: id, dep });
    }
  }
  return unresolved;
}

/** True when `<dir>/node_modules/<dep>/package.json` exists for some dir in [start … root]. */
function resolvesWithin(start, root, dep) {
  const rel = path.relative(root, start);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false; // start outside root: never look above it
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, "node_modules", ...dep.split("/"), "package.json"))) return true;
    if (dir === root) return false;
  }
}
