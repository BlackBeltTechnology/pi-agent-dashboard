/**
 * Recipe runner — the engine that executes structured subprocess Recipes.
 *
 * A Recipe is pure data: it describes *what* to run (argv from input),
 * *how to parse* the stdout, and policy (timeout, tolerated exit codes).
 * The runner owns *how to spawn*: binary resolution via `ToolResolver`,
 * always-safe defaults (`windowsHide: true`, no shell interpolation),
 * timeout enforcement, and uniform error normalization to `Result<T>`.
 *
 * Tool modules (`platform/git.ts`, `platform/openspec.ts`, `platform/npm.ts`)
 * declare Recipes and call `run()`. They never touch `child_process`,
 * `process.platform`, or `windowsHide`.
 *
 * See change: platform-command-executor.
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { spawnSync, spawn, buildSafeArgv } from "./exec.js";
import { ToolResolver } from "./binary-lookup.js";
// The tool registry publishes itself on a well-known `globalThis` symbol
// when `getDefaultRegistry()` is first called from any consumer. The
// runner reads that global to avoid a load-order cycle (tool-registry
// → platform/npm.ts → this file) that would otherwise trip Node's
// ESM/CJS translator with ERR_INTERNAL_ASSERTION on certain boots.
// See change: consolidate-tool-resolution.

// ── Types ───────────────────────────────────────────────────────────────────

/** A Recipe is a pure-data description of a subprocess operation. */
export interface Recipe<Input, Output> {
  /** Build the command + args from the typed input. First element is the command name. */
  argv: (input: Input) => readonly string[];
  /** Parse stdout (and optionally the input) into the typed result. */
  parse: (stdout: string, input: Input) => Output;
  /** Per-recipe timeout override (default: 5000ms). */
  timeout?: number;
  /**
   * Exit codes to treat as "empty success" instead of an error. Useful for
   * commands like `git diff` that exit 1 when there's no diff.
   */
  tolerate?: readonly number[];
}

/** Context passed to `run()` alongside the input. */
export interface RunCtx {
  /** Working directory for the spawn. */
  cwd?: string;
  /** Environment variables (merged over process.env). */
  env?: NodeJS.ProcessEnv;
  /** Override timeout for this call (takes precedence over recipe.timeout). */
  timeout?: number;
}

/** Discriminated error type surfaced by `run()`. */
export type ExecError =
  | { kind: "not-found"; binary: string }
  | { kind: "timeout"; timeoutMs: number; binary: string }
  | { kind: "exit"; code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }
  | { kind: "spawn-failure"; message: string };

/** Typed Result — no thrown exceptions for the 4 error kinds above. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: ExecError };

// ── Resolver cache ──────────────────────────────────────────────────────────

/**
 * Low-level ToolResolver kept as the fallback for unregistered binary
 * names. Registered names flow through the shared `ToolRegistry` so
 * user overrides apply uniformly to every Recipe.
 * See change: consolidate-tool-resolution.
 */
const sharedResolver = new ToolResolver({
  processExecPath: process.execPath,
  useLoginShell: true,
});

/**
 * Test-only hook: invalidate the registry cache. Preserved as a thin
 * shim over `registry.rescan()` so existing test suites keep working
 * after migrating away from the runner's private `resolverCache`.
 */
export function resetResolverCache(): void {
  try {
    const reg = tryGetRegistry();
    if (reg) reg.rescan();
  } catch { /* isolated tests */ }
}

// Lazy registry accessor via `globalThis` symbol. The tool-registry
// module writes itself there inside `getDefaultRegistry()`. Returns
// `null` until some consumer (e.g. the server's `/api/tools` route or
// the package-manager wrapper) constructs the registry; the runner
// then falls back to `ToolResolver.which()` for that single call.
interface LazyRegistry {
  has(n: string): boolean;
  resolve(n: string): { ok: boolean; path: string | null };
  resolveExecutor(n: string): { ok: boolean; argv: string[] };
  rescan(): void;
}
const GLOBAL_REGISTRY_KEY = Symbol.for("pi-dashboard.tool-registry");
function tryGetRegistry(): LazyRegistry | null {
  const reg = (globalThis as unknown as { [k: symbol]: LazyRegistry | undefined })[GLOBAL_REGISTRY_KEY];
  return reg ?? null;
}

/**
 * Is the argv[0] already a filesystem path (absolute or relative)? Then the
 * caller supplied the binary directly and we should not try to resolve it
 * via PATH/where/which — just use it as-is.
 */
function isPathLike(cmd: string): boolean {
  if (path.isAbsolute(cmd)) return true;
  if (cmd.startsWith("./") || cmd.startsWith("../")) return true;
  if (cmd.startsWith(".\\") || cmd.startsWith("..\\")) return true;
  return false;
}

/**
 * Resolve a binary name to an absolute path.
 *
 * Strategy:
 *   1. Path-like argv (absolute / relative) → use as-is if it exists.
 *   2. Name is registered in `ToolRegistry` → delegate to the registry
 *      so overrides, managed strategies, and diagnostics apply
 *      uniformly. The registry has its own per-instance cache; the
 *      runner no longer maintains a private `resolverCache`.
 *   3. Name is not registered → fall back to `ToolResolver.which` for
 *      ad-hoc binaries (zrok, code-server, custom tools) that the
 *      dashboard hasn't formally declared.
 *
 * Imported lazily from `../tool-registry/index.js` to keep the runner
 * usable at module-init time even if the registry hasn't finished
 * loading its overrides yet.
 */
function resolveBinary(name: string): string | null {
  if (isPathLike(name)) {
    if (existsSync(name)) return name;
    return null;
  }
  // Registered tools flow through the registry (overrides + diagnostics).
  // The `tool-registry` module imports this file transitively via
  // `platform/npm.ts`; the cycle is benign at function-call time because
  // every module has finished evaluating by the time `resolveBinary` is
  // first invoked (it's called only from inside `run()`).
  const registry = tryGetRegistry();
  if (registry && registry.has(name)) {
    const resolved = registry.resolve(name);
    return resolved.ok ? resolved.path : null;
  }
  return sharedResolver.which(name);
}

/**
 * Resolve a Recipe's argv[0] to a spawn-ready argv via the tool
 * registry's `resolveExecutor`. This is the path that lets `npm`,
 * `openspec`, `pi` all resolve to `[node.exe, <script>.js]` on
 * Windows — bypassing `.cmd` shims and the console-flash chain.
 *
 * Returns `null` when the binary is unknown AND not on PATH.
 *
 * Non-registered names fall back to `ToolResolver.which()` (single
 * path, no executor wrapping). Path-like names (absolute/relative
 * paths) are trusted as-is.
 */
function resolveExecutorArgv(name: string, recipeArgs: readonly string[]): string[] | null {
  if (isPathLike(name)) {
    if (existsSync(name)) return [name, ...recipeArgs];
    return null;
  }
  const registry = tryGetRegistry();
  if (registry && registry.has(name)) {
    const exec = registry.resolveExecutor(name);
    if (exec.ok && exec.argv.length > 0) {
      return [...exec.argv, ...recipeArgs];
    }
    return null;
  }
  const p = sharedResolver.which(name);
  return p ? [p, ...recipeArgs] : null;
}

// ── The engine ──────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Execute a Recipe against a typed input. Returns a `Result<Output>`.
 * Never throws for recognized error conditions (not-found / timeout /
 * exit / spawn-failure) — surfaces them as typed errors instead.
 */
export function run<Input, Output>(
  recipe: Recipe<Input, Output>,
  input: Input,
  ctx: RunCtx = {},
): Result<Output> {
  const argv = recipe.argv(input);
  if (argv.length === 0) {
    return { ok: false, error: { kind: "spawn-failure", message: "Recipe produced empty argv" } };
  }

  const [rawCmd, ...recipeArgs] = argv;
  const execArgv = resolveExecutorArgv(rawCmd, recipeArgs);
  if (!execArgv) {
    return { ok: false, error: { kind: "not-found", binary: rawCmd } };
  }

  const timeout = ctx.timeout ?? recipe.timeout ?? DEFAULT_TIMEOUT_MS;

  // Route every command through `buildSafeArgv` — the canonical
  // Windows-safe subprocess invocation. `execArgv` is already
  // `[node.exe, <script>.js, ...args]` for executor-kind tools, so
  // buildSafeArgv sees node.exe (.exe → direct spawn) and returns
  // the argv unchanged. For non-executor tools resolving to `.cmd`,
  // buildSafeArgv wraps in `cmd.exe /d /s /c`.
  //
  // See change: consolidate-windows-spawn-and-platform-handlers.
  const [execCmd, ...execArgs] = execArgv;
  const { argv: safeArgv, spawnOptions } = buildSafeArgv(execCmd, execArgs);

  try {
    const result = spawnSync(safeArgv[0], safeArgv.slice(1), {
      cwd: ctx.cwd,
      env: ctx.env ? { ...process.env, ...ctx.env } : undefined,
      encoding: "utf-8",
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
      ...spawnOptions, // shell: false, windowsHide: true
    });

    // spawnSync error path: either it set .error (e.g. spawn failure) or
    // it timed out (in which case signal === "SIGTERM" on Node >= 15).
    if (result.error) {
      const err = result.error as NodeJS.ErrnoException;
      if (err.code === "ETIMEDOUT" || err.message?.includes("ETIMEDOUT")) {
        return { ok: false, error: { kind: "timeout", timeoutMs: timeout, binary: rawCmd } };
      }
      return { ok: false, error: { kind: "spawn-failure", message: err.message } };
    }

    // Node's spawnSync signals timeout by setting signal = SIGTERM and status = null.
    if (result.status === null && result.signal) {
      return { ok: false, error: { kind: "timeout", timeoutMs: timeout, binary: rawCmd } };
    }

    const stdout = typeof result.stdout === "string" ? result.stdout : String(result.stdout ?? "");
    const stderr = typeof result.stderr === "string" ? result.stderr : String(result.stderr ?? "");

    const status = result.status;
    const tolerated = status !== 0 && recipe.tolerate?.includes(status ?? -1);
    if (status === 0 || tolerated) {
      return { ok: true, value: recipe.parse(stdout, input) };
    }
    return { ok: false, error: { kind: "exit", code: status, signal: result.signal, stdout, stderr } };
  } catch (err) {
    return {
      ok: false,
      error: { kind: "spawn-failure", message: err instanceof Error ? err.message : String(err) },
    };
  }
}

/**
 * Async sibling of `run()`. Same Recipe contract, same binary
 * resolution, same `.cmd`/shell handling, same error normalization
 * — but spawns via `platform/exec.ts`'s wrapped `spawn` (with stdout
 * captured to a Promise) instead of `spawnSync`, so callers can run
 * many recipes concurrently without blocking the event loop.
 *
 * Use this from server code paths that iterate over many inputs (e.g.
 * `openspec status --change <name>` across ~20 changes). The sync
 * `run()` is fine for one-off calls or for callers that must stay
 * sync (the bridge extension's sync hooks).
 *
 * `windowsHide: true` comes from the shared `spawn` wrapper — the
 * same invariant the sync runner relies on. Do not re-introduce a
 * bare `child_process.spawn` elsewhere.
 *
 * See change: consolidate-tool-resolution (async runner follow-up).
 */
export function runAsync<Input, Output>(
  recipe: Recipe<Input, Output>,
  input: Input,
  ctx: RunCtx = {},
): Promise<Result<Output>> {
  const argv = recipe.argv(input);
  if (argv.length === 0) {
    return Promise.resolve({ ok: false, error: { kind: "spawn-failure", message: "Recipe produced empty argv" } });
  }

  const [rawCmd, ...recipeArgs] = argv;
  const execArgv = resolveExecutorArgv(rawCmd, recipeArgs);
  if (!execArgv) {
    return Promise.resolve({ ok: false, error: { kind: "not-found", binary: rawCmd } });
  }

  const timeout = ctx.timeout ?? recipe.timeout ?? DEFAULT_TIMEOUT_MS;

  // Executor-kind tools resolve to `[node.exe, script.js, ...]` on
  // Windows so buildSafeArgv's `.cmd` wrapping is a no-op here — pure
  // node.exe spawn, no cmd.exe in the chain.
  const [execCmd, ...execArgs] = execArgv;
  const { argv: safeArgv, spawnOptions } = buildSafeArgv(execCmd, execArgs);

  return new Promise<Result<Output>>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (r: Result<Output>) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    let child: import("node:child_process").ChildProcess;
    try {
      child = spawn(safeArgv[0], safeArgv.slice(1), {
        cwd: ctx.cwd,
        env: ctx.env ? { ...process.env, ...ctx.env } : undefined,
        stdio: ["ignore", "pipe", "pipe"],
        ...spawnOptions, // shell: false, windowsHide: true
      });
    } catch (err) {
      settle({ ok: false, error: { kind: "spawn-failure", message: err instanceof Error ? err.message : String(err) } });
      return;
    }

    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      settle({ ok: false, error: { kind: "timeout", timeoutMs: timeout, binary: rawCmd } });
    }, timeout);

    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf-8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf-8"); });

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ETIMEDOUT" || err.message?.includes("ETIMEDOUT")) {
        settle({ ok: false, error: { kind: "timeout", timeoutMs: timeout, binary: rawCmd } });
        return;
      }
      settle({ ok: false, error: { kind: "spawn-failure", message: err.message } });
    });

    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      const tolerated = code !== 0 && code !== null && recipe.tolerate?.includes(code);
      if (code === 0 || tolerated) {
        try {
          settle({ ok: true, value: recipe.parse(stdout, input) });
        } catch (err) {
          settle({ ok: false, error: { kind: "spawn-failure", message: err instanceof Error ? err.message : String(err) } });
        }
        return;
      }
      settle({ ok: false, error: { kind: "exit", code, signal, stdout, stderr } });
    });
  });
}
// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get the value or a fallback. Use when the caller doesn't care about the
 * error discriminant (best-effort operations).
 *
 *   const branch = unwrap(git.currentBranch({ cwd }), null);
 */
export function unwrap<T>(result: Result<T>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
