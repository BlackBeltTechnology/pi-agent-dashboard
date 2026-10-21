/**
 * Host side of `ctx.serveApp`: the trust gate (design D2) and the per-plugin
 * binding handed to `createServerPluginContext`. The mount itself (validation,
 * registry, request handling) lives in the runtime package (`mountApp`).
 *
 * A plugin is TRUSTED when it is BUNDLED, or its manifest id is in config `auth.trustedPlugins` (the
 * single operator trust list, any entry for the id) or in the legacy `auth.capabilityRoutePlugins`
 * (read, never written by the dashboard). BUNDLED = discovery `source` ∈ {workspace, bundled, installed},
 * `realpath(packageDir)` a direct child of `realpath(<repo>/packages)`, `realpath(resources/plugins)`
 * or `realpath(~/.pi/dashboard/plugins)`, and its (real) DIRECTORY name in
 * `packages/server/package.json#piDashboard.bundledPlugins`. A `pi-package` / `local-detected`
 * copy never counts, so a spoofed basename under `~/.pi/agent/npm/node_modules` is refused
 * (design D12, R17). `manifest.priority` is a render-order
 * knob and never trust. An untrusted call mounts nothing and warns once, so an
 * untrusted plugin cannot squat a trusted app's id.
 *
 * API guardrail against accidents, not a boundary against a malicious in-process plugin.
 *
 * See change: add-plugin-capability-routes (D2, D5); decouple-plugins-from-core (task 6.6, D12).
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  findBundledPluginsDir,
  findInstalledPluginsDir,
  findMonorepoRoot,
  getPluginStatusStore,
  mountApp,
  type ServeAppOptions,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { PluginDiscoverySource } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/plugin-status.js";
import type { FastifyInstance } from "fastify";
import { readTrustedPlugins } from "./plugin-trust-store.js";

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
  /** Absolute path of the plugin package directory (its real basename is the bundled-list key). */
  packageDir: string;
  /** Manifest id (the `auth.capabilityRoutePlugins` key). */
  manifestId: string;
  /** Discovery source of the winning copy. Absent → never bundled (fail closed). */
  source?: PluginDiscoverySource;
}

const BUNDLED_SOURCES: ReadonlySet<PluginDiscoverySource> = new Set(["workspace", "bundled", "installed"]);

function realpathOrNull(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/** Real roots a bundled plugin may live directly under: `<repo>/packages`, `resources/plugins`, `~/.pi/dashboard/plugins`. */
function readBundledPluginRoots(): string[] {
  const monorepo = findMonorepoRoot();
  const candidates = [monorepo ? path.join(monorepo, "packages") : null, findBundledPluginsDir(), findInstalledPluginsDir()];
  return candidates.flatMap((c) => {
    const real = c ? realpathOrNull(c) : null;
    return real ? [real] : [];
  });
}

/**
 * Pure trust decision: bundled (path-contained), OR listed in `auth.trustedPlugins` (`trustedIds`),
 * OR named in the legacy `auth.capabilityRoutePlugins` (`configuredIds`).
 */
export function isServeAppTrusted(
  plugin: ServeAppTrustInput,
  lists: {
    bundledDirs: ReadonlySet<string>;
    configuredIds: readonly string[];
    /** Ids with an `auth.trustedPlugins` entry (any entry: the list is the one operator trust list). */
    trustedIds?: readonly string[];
    bundledRoots?: readonly string[];
  },
): boolean {
  if (lists.configuredIds.includes(plugin.manifestId)) return true;
  if (lists.trustedIds?.includes(plugin.manifestId)) return true;
  if (!plugin.source || !BUNDLED_SOURCES.has(plugin.source)) return false;
  const real = realpathOrNull(plugin.packageDir);
  if (!real || !lists.bundledDirs.has(path.basename(real))) return false;
  const roots = lists.bundledRoots ?? readBundledPluginRoots();
  const parent = path.dirname(real);
  return roots.some((root) => parent === root);
}

/** Live ids of `auth.trustedPlugins`. */
function readTrustedIds(): readonly string[] {
  return readTrustedPlugins().map((e) => e.id);
}

export interface HostServeAppDeps {
  fastify: FastifyInstance;
  plugin: ServeAppTrustInput;
  /** Live read of the legacy `auth.capabilityRoutePlugins` (read when the plugin activates). */
  readConfiguredIds: () => readonly string[];
  /** Live read of `auth.trustedPlugins` ids; defaults to the config. */
  readTrustedIds?: () => readonly string[];
  /** Records the mount outcome; defaults to `PluginStatus.serveApp` in the status store. */
  recordOutcome?: (pluginId: string, state: "mounted" | "refused") => void;
  /** Overridable for tests; defaults to the server package's bundled list. */
  bundledDirs?: ReadonlySet<string>;
  /** Overridable for tests; real roots a bundled plugin must sit directly under. */
  bundledRoots?: readonly string[];
}

/** The `deps.serveApp` binding for one plugin: trust-gate, then mount. */
export function createHostServeApp(deps: HostServeAppDeps): (opts: ServeAppOptions, env: { dataDir: string }) => void {
  const { plugin } = deps;
  const record = deps.recordOutcome ?? ((id, state) => getPluginStatusStore().recordServeApp(id, state));
  let warned = false;
  return (opts, env) => {
    const trusted = isServeAppTrusted(plugin, {
      bundledDirs: deps.bundledDirs ?? readBundledPluginDirs(),
      configuredIds: deps.readConfiguredIds(),
      trustedIds: (deps.readTrustedIds ?? readTrustedIds)(),
      bundledRoots: deps.bundledRoots,
    });
    if (!trusted) {
      record(plugin.manifestId, "refused");
      if (!warned) {
        warned = true;
        console.warn(
          `[serveApp] plugin '${plugin.manifestId}' is not trusted to mount an app (bundled plugin, auth.trustedPlugins or auth.capabilityRoutePlugins); ignoring`,
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
    record(plugin.manifestId, "mounted");
  };
}

/**
 * Whether a trust change flips a plugin's `serveApp` outcome: the mount is decided at activation, so a
 * refused app that is trusted now (grant), or a mounted one that is no longer trusted (revoke), needs a
 * restart. Pure.
 */
export function serveAppRestartNeeded(recorded: "mounted" | "refused" | undefined, trustedNow: boolean): boolean {
  return (recorded === "refused" && trustedNow) || (recorded === "mounted" && !trustedNow);
}

/**
 * After a trust grant/revoke: compare the plugin's CURRENT `serveApp` trust with the outcome recorded at
 * activation and set `restartRequired` on its status row when they differ (spec "Trust freshness differs
 * per surface"). Returns whether the row was flagged; the caller broadcasts `plugins_changed`. A plugin
 * that never called `serveApp` (no recorded outcome) is untouched.
 */
export function noteServeAppTrustChange(plugin: ServeAppTrustInput): boolean {
  const store = getPluginStatusStore();
  const stored = store.getStoredStatus(plugin.manifestId);
  const recorded = store.getStatus(plugin.manifestId)?.serveApp;
  if (!stored || stored.restartRequired) return false;
  const trustedNow = isServeAppTrusted(plugin, {
    bundledDirs: readBundledPluginDirs(),
    configuredIds: loadConfig().auth?.capabilityRoutePlugins ?? [],
    trustedIds: readTrustedIds(),
  });
  if (!serveAppRestartNeeded(recorded, trustedNow)) return false;
  store.setStatus({ ...stored, restartRequired: true });
  return true;
}
