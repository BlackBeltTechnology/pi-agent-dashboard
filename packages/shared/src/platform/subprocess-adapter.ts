/**
 * Subprocess adapter — strategy pattern for OS-aware subprocess invocation.
 *
 * The adapter is the single point of entry for spawning any subprocess
 * from dashboard code or from libraries we wrap. It dispatches to a
 * platform-specific implementation:
 *
 *   - Windows: `.cmd`/`.bat` shims go through explicit `cmd.exe /d /s /c`
 *     invocation with `windowsHide: true` and `shell: false` (the only
 *     reliable way to avoid Node issue #21825's flashing console).
 *     Native `.exe`s spawn directly.
 *   - Unix: direct spawn, no shell, no special cases.
 *
 * Why an adapter instead of a global monkey-patch?
 *
 *   - Explicit dependency injection. Callers (and tests) know exactly
 *     which spawn implementation they get.
 *   - Isolated — third-party code that needs this behaviour gets it via
 *     a thin subclass that consumes the adapter (see
 *     `createSafePackageManagerClass` in
 *     `packages/server/src/package-manager-wrapper.ts`). No cross-
 *     cutting global state.
 *   - Testable: fake adapter => assert argv without spawning real
 *     subprocesses.
 *
 * See change: consolidate-windows-spawn-and-platform-handlers.
 */
import type {
  ChildProcess,
  SpawnOptions,
  SpawnSyncOptions,
  SpawnSyncReturns,
} from "node:child_process";
import {
  spawn as safeSpawn,
  spawnSync as safeSpawnSync,
  buildSafeArgv,
} from "./exec.js";

// ── Interface ──────────────────────────────────────────────────────────────

/**
 * Cross-platform subprocess adapter. Implementations guarantee:
 *   - `windowsHide: true` on Windows, always.
 *   - No `shell: true` ever — `.cmd` shims are invoked via explicit
 *     `cmd.exe /d /s /c` argv.
 *   - Arg arrays are passed verbatim, no shell-escaping surprises.
 */
export interface SubprocessAdapter {
  /** Async spawn. Returns the live ChildProcess. */
  spawn(command: string, args?: readonly string[], options?: SpawnOptions): ChildProcess;

  /** Synchronous spawn. Blocks until completion. */
  spawnSync<T extends string | Buffer = Buffer>(
    command: string,
    args?: readonly string[],
    options?: SpawnSyncOptions,
  ): SpawnSyncReturns<T>;
}

// ── Windows implementation ─────────────────────────────────────────────────

class WindowsSubprocessAdapter implements SubprocessAdapter {
  spawn(command: string, args: readonly string[] = [], options?: SpawnOptions): ChildProcess {
    const { argv, spawnOptions } = buildSafeArgv(command, args, "win32");
    return safeSpawn(argv[0], argv.slice(1), { ...(options ?? {}), ...spawnOptions });
  }

  spawnSync<T extends string | Buffer = Buffer>(
    command: string,
    args: readonly string[] = [],
    options?: SpawnSyncOptions,
  ): SpawnSyncReturns<T> {
    const { argv, spawnOptions } = buildSafeArgv(command, args, "win32");
    return safeSpawnSync<T>(argv[0], argv.slice(1), { ...(options ?? {}), ...spawnOptions });
  }
}

// ── Unix implementation ────────────────────────────────────────────────────

class UnixSubprocessAdapter implements SubprocessAdapter {
  spawn(command: string, args: readonly string[] = [], options?: SpawnOptions): ChildProcess {
    return safeSpawn(command, args, { ...(options ?? {}), shell: false });
  }

  spawnSync<T extends string | Buffer = Buffer>(
    command: string,
    args: readonly string[] = [],
    options?: SpawnSyncOptions,
  ): SpawnSyncReturns<T> {
    return safeSpawnSync<T>(command, args, { ...(options ?? {}), shell: false });
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Return the appropriate adapter for the given platform. Default:
 * `process.platform`. Tests pass explicit values without mutating the
 * global.
 */
export function createSubprocessAdapter(
  platform: NodeJS.Platform = process.platform,
): SubprocessAdapter {
  if (platform === "win32") return new WindowsSubprocessAdapter();
  return new UnixSubprocessAdapter();
}

/**
 * Process-wide default adapter. Constructed lazily on first access.
 * Callers that want a different strategy (e.g. tests injecting a fake)
 * pass the adapter explicitly to their constructor instead of using
 * this singleton.
 */
let defaultAdapter: SubprocessAdapter | null = null;
export function getDefaultSubprocessAdapter(): SubprocessAdapter {
  if (!defaultAdapter) defaultAdapter = createSubprocessAdapter();
  return defaultAdapter;
}

/** Test-only: drop the cached default adapter. */
export function _resetDefaultSubprocessAdapter(): void {
  defaultAdapter = null;
}
