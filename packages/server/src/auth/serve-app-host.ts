/**
 * Host side of `ctx.serveApp`: the trust gate (design D2) and the per-plugin
 * binding handed to `createServerPluginContext`. The mount itself (validation,
 * registry, request handling) lives in the runtime package (`mountApp`).
 *
 * A plugin is TRUSTED when its package DIRECTORY name is in
 * `packages/server/package.json#piDashboard.bundledPlugins`, or its manifest id is
 * in config `auth.capabilityRoutePlugins`. `manifest.priority` is a render-order
 * knob and never trust. An untrusted call mounts nothing and warns once, so an
 * untrusted plugin cannot squat a trusted app's id.
 *
 * API guardrail against accidents, not a boundary against a malicious in-process plugin.
 *
 * See change: add-plugin-capability-routes (D2, D5).
 */
import { createRequire } from "node:module";
import path from "node:path";
import { mountApp, type ServeAppOptions } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { FastifyInstance } from "fastify";

const nodeRequire = createRequire(import.meta.url);

let bundledDirsCache: ReadonlySet<string> | undefined;

/** `piDashboard.bundledPlugins` of the server package (package DIRECTORY names, e.g. `goal-plugin`). Cached. */
export function readBundledPluginDirs(): ReadonlySet<string> {
  if (!bundledDirsCache) {
    let dirs: string[] = [];
    try {
      const list = (nodeRequire("../../package.json") as { piDashboard?: { bundledPlugins?: unknown } }).piDashboard?.bundledPlugins;
      if (Array.isArray(list)) dirs = list.filter((d): d is string => typeof d === "string");
    } catch {
      /* unreadable → no bundled trust (fail closed) */
    }
    bundledDirsCache = new Set(dirs);
  }
  return bundledDirsCache;
}

export interface ServeAppTrustInput {
  /** Absolute path of the plugin package directory (its basename is the bundled-list key). */
  packageDir: string;
  /** Manifest id (the `auth.capabilityRoutePlugins` key). */
  manifestId: string;
}

/** Pure trust decision: bundled by directory name, OR named in `auth.capabilityRoutePlugins`. */
export function isServeAppTrusted(
  plugin: ServeAppTrustInput,
  lists: { bundledDirs: ReadonlySet<string>; configuredIds: readonly string[] },
): boolean {
  return lists.bundledDirs.has(path.basename(plugin.packageDir)) || lists.configuredIds.includes(plugin.manifestId);
}

export interface HostServeAppDeps {
  fastify: FastifyInstance;
  plugin: ServeAppTrustInput;
  /** Live read of `auth.capabilityRoutePlugins` (read when the plugin activates). */
  readConfiguredIds: () => readonly string[];
  /** Overridable for tests; defaults to the server package's bundled list. */
  bundledDirs?: ReadonlySet<string>;
}

/** The `deps.serveApp` binding for one plugin: trust-gate, then mount. */
export function createHostServeApp(deps: HostServeAppDeps): (opts: ServeAppOptions, env: { dataDir: string }) => void {
  const { plugin } = deps;
  let warned = false;
  return (opts, env) => {
    const trusted = isServeAppTrusted(plugin, {
      bundledDirs: deps.bundledDirs ?? readBundledPluginDirs(),
      configuredIds: deps.readConfiguredIds(),
    });
    if (!trusted) {
      if (!warned) {
        warned = true;
        console.warn(
          `[serveApp] plugin '${plugin.manifestId}' is not trusted to mount an app (bundled plugin or auth.capabilityRoutePlugins); ignoring`,
        );
      }
      return;
    }
    mountApp(
      {
        fastify: deps.fastify,
        pluginId: plugin.manifestId,
        packageRoot: plugin.packageDir,
        dataDir: env.dataDir,
        logger: {
          info: (msg, ...args) => console.info(`[plugin:${plugin.manifestId}]`, msg, ...args),
          warn: (msg, ...args) => console.warn(`[plugin:${plugin.manifestId}]`, msg, ...args),
          error: (msg, ...args) => console.error(`[plugin:${plugin.manifestId}]`, msg, ...args),
        },
      },
      opts,
    );
  };
}
