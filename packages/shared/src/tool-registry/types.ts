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
  | "bare-import";

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
