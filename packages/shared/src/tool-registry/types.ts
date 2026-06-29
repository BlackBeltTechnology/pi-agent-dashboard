/**
 * Public type contract for the tool registry.
 *
 * The registry resolves every external binary, module, or directory the
 * dashboard depends on through an ordered list of strategies. Each
 * resolution records a diagnostic trail (what was tried + why it
 * succeeded/failed) alongside the winning path.
 *
 * See change: consolidate-tool-resolution.
 */

/** What kind of artifact a tool definition resolves. */
export type ToolKind = "binary" | "module" | "directory" | "executor";

/**
 * How a resolved path was obtained. Strategy name → source mapping is
 * declared by each tool definition's `classify()` (see registry).
 */
export type Source =
  | "override"
  | "managed"
  | "system"
  | "npm-global"
  | "bare-import"
  | "bundled";

/** Result returned by a single strategy attempt. */
export type StrategyResult =
  | { ok: true; path: string }
  | { ok: false; reason: string };

/** One attempt recorded on a Resolution's `tried[]` list. */
export interface TriedEntry {
  /** Strategy name, e.g. "override", "managed", "npm-global". */
  strategy: string;
  /** "ok" on success, the strategy's failure reason on miss. */
  result: "ok" | string;
}

/** Output of `ToolRegistry.resolve(name)`. */
export interface Resolution {
  /** Tool name as registered. */
  name: string;
  /** True if any strategy produced a valid path. */
  ok: boolean;
  /** Absolute path (binary / module entry / directory). Null on failure. */
  path: string | null;
  /** Source classification of the winning strategy. Null on failure. */
  source: Source | null;
  /** Ordered diagnostic trail — one entry per attempted strategy. */
  tried: TriedEntry[];
  /** Epoch ms when resolution completed. */
  resolvedAt: number;
}

/**
 * Output of `ToolRegistry.resolveExecutor(name)` — extends Resolution
 * with `argv`, the ready-to-spawn command array.
 *
 * Callers spawn via `spawn(argv[0], [...argv.slice(1), ...userArgs])`.
 * For simple binaries `argv = [path]`; for scripts that need an
 * interpreter (e.g. pi's `node dist/cli.js` on Windows) `argv =
 * [interpreter, scriptPath]`.
 *
 * See change: consolidate-windows-spawn-and-platform-handlers.
 */
export interface ExecutorResolution extends Resolution {
  argv: string[];
}

/** Context passed to every strategy function. */
export interface StrategyCtx {
  /** Per-registry override map, { [toolName]: absolutePath }. */
  overrides: Readonly<Record<string, string>>;
  /** Platform discriminator (injectable for tests). */
  platform: NodeJS.Platform;
  /**
   * Environment overrides used by HOME-sensitive strategies (managed/*,
   * npm-global under APPDATA on win32, etc.). Production registries
   * populate from `os.homedir()` + `process.cwd()`; tests inject fakes
   * so the harness can reason about alternate HOME directories without
   * mutating globals.
   */
  env?: {
    homedir?: string;
    cwd?: string;
    /**
     * Electron-only: absolute path to the packaged-app Resources/ dir
     * (matches `process.resourcesPath`). Undefined outside Electron;
     * strategies that probe bundled-with-app artifacts (e.g. the
     * bundled Node runtime at `<resourcesPath>/node/`) fast-fail when
     * unset. See change: fix-node-resolution-under-electron.
     */
    resourcesPath?: string;
  };
}

/** A single resolution strategy. Pure function of its ctx + the tool's data. */
export interface Strategy {
  /** Name recorded in `tried[]`. */
  name: string;
  /** Attempt resolution. Never throws — signal failure via { ok: false }. */
  run(ctx: StrategyCtx): StrategyResult;
}

/**
 * Transform a successfully-resolved path into an argv ready to pass
 * to `spawn(argv[0], argv.slice(1))`.
 *
 * Default behaviour (when a definition omits `toArgv`): `argv = [path]`.
 * Scripts that need an interpreter (e.g. pi's `cli.js` on Windows)
 * return `[interpreterPath, scriptPath]`.
 *
 * The function may call `registry.resolve(...)` to look up peer tools
 * (e.g. `node`). It MUST NOT throw — return the path-only fallback
 * `[path]` if a peer tool is missing.
 */
export type ToArgvFn = (resolvedPath: string, ctx: { platform: NodeJS.Platform; registry: ToolRegistryLike }) => string[];

/** Minimal interface used by `toArgv` functions to look up peer tools. */
export interface ToolRegistryLike {
  resolve(name: string): Resolution;
}

/**
 * Per-OS install guidance for a tool. Pure UX metadata — the registry
 * never consults it during resolution. Surfaced by `ToolRegistry.list()`
 * and the REST `/api/tools` endpoint; the Settings → Tools UI renders it
 * as an `[Install ▾]` dropdown on missing-tool rows.
 *
 * See change: register-bash-and-tool-install-help.
 */
export interface InstallHints {
  darwin?: PlatformInstallHint;
  win32?: PlatformInstallHint;
  linux?: PlatformInstallHint;
  /** Anchor under docs/faq.md for human-written install guidance. */
  docsAnchor?: string;
}

/** Install guidance for one OS. */
export interface PlatformInstallHint {
  /** Package-manager label → install command (e.g. { brew: "brew install zrok" }). */
  commands?: Record<string, string>;
  /** Free-form fallback when no package manager applies (e.g. "Pre-installed on macOS"). */
  manual?: string;
  /** Canonical vendor download URL. */
  url?: string;
}

/** Declarative tool registration. */
export interface ToolDefinition {
  /** Registry key — unique within the registry. */
  name: string;
  /** Kind drives how `resolveModule()` / path validation behaves. */
  kind: ToolKind;
  /**
   * Ordered strategies used when no platform-specific override exists
   * for the current OS. First successful strategy wins.
   */
  strategies: Strategy[];
  /**
   * Optional per-platform strategy override. Present key wins over
   * `strategies`. Absent key falls back to `strategies`.
   *
   * Use this when the chain itself is OS-dependent — e.g. pi on
   * Windows looks for a JS entry (dist/cli.js via module strategies),
   * while on Unix it looks for a `pi` binary on PATH.
   */
  platformStrategies?: Partial<Record<NodeJS.Platform, Strategy[]>>;
  /**
   * Optional transform from resolved path → ready-to-spawn argv.
   * Used by `resolveExecutor(name)`. Omitted → argv defaults to `[path]`.
   */
  toArgv?: ToArgvFn;
  /**
   * Map a winning strategy name → Source. Unknown strategy names fall
   * back to the default ("system"). Definitions usually set this so
   * that e.g. "managed" → "managed", "bare-import" → "bare-import".
   */
  classify?(strategyName: string): Source;
  /**
   * Optional post-resolution validation (e.g. "dist/index.js exists").
   * If provided and returns a reason, the strategy is demoted to a
   * failure carrying that reason, and the next strategy is tried.
   */
  validate?(resolvedPath: string): { ok: true } | { ok: false; reason: string };
  /**
   * Optional per-OS install guidance. Opaque to resolution — `resolve()`
   * ignores it; only `list()` / REST surface it.
   * See change: register-bash-and-tool-install-help.
   */
  installHints?: InstallHints;
}

/**
 * One row of `ToolRegistry.list()`. Extends Resolution with the tool's
 * static `installHints` so the Resolution shape stays resolution-only
 * (resolve() never carries hints). Field omitted when the definition
 * declares no hints. See change: register-bash-and-tool-install-help.
 */
export interface ToolListEntry extends Resolution {
  installHints?: InstallHints;
}

// ── Errors ──────────────────────────────────────────────────────────────────

/** Thrown by `resolve()` / `resolveModule()` for unregistered names. */
export class UnknownToolError extends Error {
  public readonly tool: string;
  constructor(tool: string) {
    super(`Unknown tool: ${tool}`);
    this.name = "UnknownToolError";
    this.tool = tool;
  }
}

/** Thrown by `resolveModule()` when every strategy fails. */
export class ModuleResolutionError extends Error {
  public readonly resolution: Resolution;
  constructor(resolution: Resolution) {
    const trail = resolution.tried
      .map((t) => `  - ${t.strategy}: ${t.result}`)
      .join("\n");
    super(
      `Could not resolve module "${resolution.name}". Tried:\n${trail}`,
    );
    this.name = "ModuleResolutionError";
    this.resolution = resolution;
  }
}
