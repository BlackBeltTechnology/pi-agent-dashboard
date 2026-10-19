/**
 * Pure spawn-scope helper for plugins: merges the guard into a `PluginSpawnOptions.scope`
 * (the `-e` entry plus its `extensionConfig`), so a plugin opts in without hand-typing the
 * env namespace. Imports no pi / server / runtime module — safe to import from a plugin.
 *
 * `import.meta.url` stays UNCAST: a bare one is an erasable shape jiti inlines; a TS cast
 * around it forces jiti's native-ESM `data:` fallback (jiti-cjs-transpile-safety).
 * See change: add-path-containment-guard-extension (D5).
 */
import { fileURLToPath } from "node:url";
import { PATH_CONTAINMENT_GUARD_EXT_NAME } from "@blackbelt-technology/pi-dashboard-shared/path-containment-guard-name.js";
import { isAcceptableRoot } from "./config.js";

export interface GuardOptions {
  allowedRoots: string[];
  deniedTools?: string[];
}

export interface GuardScopeBase {
  extensions?: string[];
  extensionConfig?: Record<string, Record<string, string | string[]>>;
}

export type GuardedScope<S extends GuardScopeBase> = S & {
  extensions: string[];
  extensionConfig: Record<string, Record<string, string | string[]>>;
};

export function withPathContainmentGuard<S extends GuardScopeBase = GuardScopeBase>(
  opts: GuardOptions,
  base?: S,
): GuardedScope<S> {
  if (!Array.isArray(opts.allowedRoots) || !opts.allowedRoots.some((r) => isAcceptableRoot(r))) {
    throw new Error("withPathContainmentGuard: allowedRoots must contain at least one non-empty absolute path");
  }
  if (opts.deniedTools !== undefined) {
    if (!Array.isArray(opts.deniedTools) || !opts.deniedTools.every((t) => typeof t === "string" && t !== "")) {
      throw new Error("withPathContainmentGuard: deniedTools entries must be non-empty strings");
    }
  }
  if (base?.extensionConfig && PATH_CONTAINMENT_GUARD_EXT_NAME in base.extensionConfig) {
    throw new Error(`withPathContainmentGuard: scope already has an extensionConfig.${PATH_CONTAINMENT_GUARD_EXT_NAME} entry`);
  }
  const entry = fileURLToPath(new URL("./extension.ts", import.meta.url));
  return {
    ...(base as S),
    extensions: [...(base?.extensions ?? []), entry],
    extensionConfig: {
      ...base?.extensionConfig,
      [PATH_CONTAINMENT_GUARD_EXT_NAME]: {
        allowedRoots: [...opts.allowedRoots],
        ...(opts.deniedTools !== undefined && { deniedTools: [...opts.deniedTools] }),
      },
    },
  };
}
