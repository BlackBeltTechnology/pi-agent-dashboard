/**
 * ToolRegistry — single-source resolver for every external binary, module,
 * and directory the dashboard depends on.
 *
 * Design (see change: consolidate-tool-resolution, design §1-§4):
 *   - Ordered strategy chain per tool (override → managed → bare-import →
 *     npm-global → where).
 *   - One Resolution record per tool, cached in the registry.
 *   - Rescan invalidates one or all cached Resolutions.
 *   - Module resolution dynamically imports the resolved entry and caches
 *     the loaded ES module alongside the Resolution.
 */
import { pathToFileURL } from "node:url";
import {
  type ExecutorResolution,
  ModuleResolutionError,
  type Resolution,
  type Source,
  type StrategyCtx,
  type ToolDefinition,
  UnknownToolError,
  type TriedEntry,
} from "./types.js";
import { OverridesStore } from "./overrides.js";

export interface ToolRegistryDeps {
  overrides?: OverridesStore;
  platform?: NodeJS.Platform;
  /** Injected for tests; default uses native dynamic `import(url)`. */
  importModule?: (url: string) => Promise<unknown>;
  /** Clock injector (used by tests for deterministic `resolvedAt`). */
  now?: () => number;
}

/** Default strategy → source mapping when a definition doesn't override it. */
const DEFAULT_CLASSIFY = (strategyName: string): Source => {
  switch (strategyName) {
    case "override":
      return "override";
    case "managed":
      return "managed";
    case "bare-import":
      return "bare-import";
    case "npm-global":
      return "npm-global";
    default:
      return "system";
  }
};

export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>();
  private readonly cache = new Map<string, Resolution>();
  private readonly moduleCache = new Map<string, unknown>();
  private readonly overrides: OverridesStore;
  private readonly platform: NodeJS.Platform;
  private readonly importModule: (url: string) => Promise<unknown>;
  private readonly now: () => number;

  constructor(deps: ToolRegistryDeps = {}) {
    this.overrides = deps.overrides ?? new OverridesStore();
    this.platform = deps.platform ?? process.platform;
    this.importModule = deps.importModule ?? ((url) => import(/* @vite-ignore */ url));
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Platform the registry was created for (or the current runtime's
   * `process.platform`). Exposed so platform-conditional tool registration
   * (e.g. skip `ps`/`pgrep` on Windows) in `registerDefaultTools` honours
   * the test's injected platform instead of always reading the host.
   */
  getPlatform(): NodeJS.Platform {
    return this.platform;
  }

  /** Register a tool definition. Last registration wins (tests re-register). */
  register(def: ToolDefinition): void {
    this.definitions.set(def.name, def);
    this.cache.delete(def.name);
    this.moduleCache.delete(def.name);
  }

  /** True when the name has a registered definition. */
  has(name: string): boolean {
    return this.definitions.has(name);
  }

  /** Snapshot of every registered tool's resolution. Triggers resolution as needed. */
  list(): Resolution[] {
    return Array.from(this.definitions.keys()).map((n) => this.resolve(n));
  }

  /** Resolve a binary/directory/module-path. Uses cached result when present. */
  resolve(name: string): Resolution {
    const def = this.definitions.get(name);
    if (!def) throw new UnknownToolError(name);

    const cached = this.cache.get(name);
    if (cached) return cached;

    const ctx: StrategyCtx = {
      overrides: this.overrides.list(),
      platform: this.platform,
    };

    const tried: TriedEntry[] = [];
    let winner: { strategy: string; path: string } | null = null;

    // Platform-specific strategy chain overrides the default when
    // present. Use case: tool resolution chain itself differs per OS
    // (e.g. `pi` on Windows finds pi-coding-agent's cli.js; on Unix
    // finds the `pi` binary on PATH).
    const strategies = def.platformStrategies?.[this.platform] ?? def.strategies;

    for (const strategy of strategies) {
      const result = strategy.run(ctx);
      if (!result.ok) {
        tried.push({ strategy: strategy.name, result: result.reason });
        continue;
      }
      // Optional validation (existence check, "must end in dist/index.js", ...).
      if (def.validate) {
        const v = def.validate(result.path);
        if (!v.ok) {
          tried.push({ strategy: strategy.name, result: `invalid: ${v.reason}` });
          continue;
        }
      }
      tried.push({ strategy: strategy.name, result: "ok" });
      winner = { strategy: strategy.name, path: result.path };
      break;
    }

    const classify = def.classify ?? DEFAULT_CLASSIFY;
    const resolution: Resolution = winner
      ? {
          name,
          ok: true,
          path: winner.path,
          source: classify(winner.strategy),
          tried,
          resolvedAt: this.now(),
        }
      : {
          name,
          ok: false,
          path: null,
          source: null,
          tried,
          resolvedAt: this.now(),
        };

    this.cache.set(name, resolution);
    return resolution;
  }

  /**
   * Resolve a tool and return its spawn-ready argv.
   *
   * Uses `resolve()` to find the artifact path, then applies the
   * definition's `toArgv` transform (if any) to produce argv. Default:
   * `argv = [path]` — appropriate for binary-kind tools resolved to an
   * absolute path on PATH.
   *
   * For executor-kind tools with platform-specific interpreter needs
   * (e.g. pi on Windows → `[node.exe, cli.js]`), `toArgv` does the
   * assembly. `toArgv` may call `this.resolve(peer)` to find peer
   * tools (e.g. `node`) and MUST fall back to `[path]` if peers are
   * missing.
   *
   * Callers spawn via `spawn(argv[0], [...argv.slice(1), ...userArgs])`.
   *
   * See change: consolidate-windows-spawn-and-platform-handlers.
   */
  resolveExecutor(name: string): ExecutorResolution {
    const def = this.definitions.get(name);
    if (!def) throw new UnknownToolError(name);

    const resolution = this.resolve(name);
    if (!resolution.ok || !resolution.path) {
      return { ...resolution, argv: [] };
    }

    const argv = def.toArgv
      ? def.toArgv(resolution.path, { platform: this.platform, registry: this })
      : [resolution.path];

    return { ...resolution, argv };
  }

  /**
   * Resolve AND dynamically import a registered module-kind tool.
   * Throws `ModuleResolutionError` with the full `tried[]` trail when
   * every strategy fails. The loaded ES module is cached alongside the
   * Resolution; `rescan(name)` invalidates both.
   */
  async resolveModule<T = unknown>(name: string): Promise<{ resolution: Resolution; module: T }> {
    const def = this.definitions.get(name);
    if (!def) throw new UnknownToolError(name);
    if (def.kind !== "module") {
      throw new Error(`Tool "${name}" is not kind: "module"; use resolve() instead.`);
    }

    const resolution = this.resolve(name);
    if (!resolution.ok || !resolution.path) {
      throw new ModuleResolutionError(resolution);
    }

    const cached = this.moduleCache.get(name) as T | undefined;
    if (cached) return { resolution, module: cached };

    const url = pathToFileURL(resolution.path).href;
    const loaded = (await this.importModule(url)) as T;
    this.moduleCache.set(name, loaded);
    return { resolution, module: loaded };
  }

  /** Drop cached Resolution(s). Next resolve() re-runs strategies. */
  rescan(name?: string): void {
    if (name === undefined) {
      this.cache.clear();
      this.moduleCache.clear();
      this.overrides.invalidate();
      return;
    }
    this.cache.delete(name);
    this.moduleCache.delete(name);
  }

  /** Set a path override. Invalidates the target's cache. */
  setOverride(name: string, overridePath: string): void {
    if (!this.definitions.has(name)) throw new UnknownToolError(name);
    this.overrides.set(name, overridePath);
    this.cache.delete(name);
    this.moduleCache.delete(name);
  }

  /** Clear a path override. Invalidates the target's cache. */
  clearOverride(name: string): void {
    if (!this.definitions.has(name)) throw new UnknownToolError(name);
    this.overrides.clear(name);
    this.cache.delete(name);
    this.moduleCache.delete(name);
  }
}
