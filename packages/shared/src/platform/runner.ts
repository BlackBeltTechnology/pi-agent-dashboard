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
import { spawnSync } from "./exec.js";
import { ToolResolver } from "./binary-lookup.js";

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

/** Per-command resolution cache. Reset via `resetResolverCache()` for tests. */
const resolverCache = new Map<string, string | null>();
const sharedResolver = new ToolResolver({
  processExecPath: process.execPath,
  useLoginShell: true,
});

/**
 * Test-only hook: clear the binary-resolution cache. Call in `beforeEach`
 * when a test needs to simulate a command appearing/disappearing from PATH.
 */
export function resetResolverCache(): void {
  resolverCache.clear();
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

function resolveBinary(name: string): string | null {
  // Absolute or relative paths: caller already resolved it; use as-is if it exists.
  if (isPathLike(name)) {
    if (existsSync(name)) return name;
    return null;
  }
  // Bare command name: route through ToolResolver (where/which + managed bin).
  if (resolverCache.has(name)) return resolverCache.get(name) ?? null;
  const resolved = sharedResolver.which(name);
  resolverCache.set(name, resolved);
  return resolved;
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

  const [rawCmd, ...args] = argv;
  const resolved = resolveBinary(rawCmd);
  if (!resolved) {
    return { ok: false, error: { kind: "not-found", binary: rawCmd } };
  }

  const timeout = ctx.timeout ?? recipe.timeout ?? DEFAULT_TIMEOUT_MS;

  try {
    const result = spawnSync(resolved, args, {
      cwd: ctx.cwd,
      env: ctx.env ? { ...process.env, ...ctx.env } : undefined,
      encoding: "utf-8",
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
      // windowsHide: true comes from exec.ts by default; no shell interpolation.
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
