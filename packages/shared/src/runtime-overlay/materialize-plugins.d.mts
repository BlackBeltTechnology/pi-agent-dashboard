/** Types for `materialize-plugins.mjs`. See change: electron-runtime-overlay-updates. */

export function readBundledPluginIds(serverPackageJsonPath: string): string[];

export function materializeBundledPlugins(opts: {
  ids: string[];
  /** Absolute source package dir for an id, or null to skip it. */
  resolveSource: (id: string) => string | null;
  destDir: string;
}): string[];
