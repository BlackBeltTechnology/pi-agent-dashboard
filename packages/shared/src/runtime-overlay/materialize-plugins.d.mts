/** Types for `materialize-plugins.mjs`. See change: electron-runtime-overlay-updates. */

export function readBundledPluginIds(serverPackageJsonPath: string): string[];

export function materializeBundledPlugins(opts: {
  ids: string[];
  /** Absolute source package dir for an id, or null to skip it. */
  resolveSource: (id: string) => string | null;
  destDir: string;
}): string[];

/**
 * Union of bundleable plugins' third-party `dependencies`; throws on a
 * specifier conflict (plugins vs plugins/workspaces) or a non-registry
 * specifier. See change: bundle-plugin-third-party-deps.
 */
export function collectPluginRuntimeDeps(opts: {
  ids: string[];
  resolveSource: (id: string) => string | null;
  workspaceManifests: { name: string; dependencies?: Record<string, string> }[];
}): Record<string, string>;

/** Declared plugin deps with no `node_modules/<dep>/package.json` between the plugin dir and `rootDir`. */
export function findUnresolvedPluginDeps(opts: {
  pluginsDir: string;
  rootDir: string;
}): { plugin: string; dep: string }[];
