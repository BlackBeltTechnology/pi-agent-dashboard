/**
 * Thin adapter around pi's DefaultPackageManager.
 * Serializes operations (one at a time), forwards progress events,
 * and triggers session reload on success.
 *
 * Pi module resolution is delegated to the shared `ToolRegistry`
 * (`resolveModule("pi-coding-agent")`). All strategy chains, caching,
 * and diagnostic trails live there — see change: consolidate-tool-resolution.
 */
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  getDefaultRegistry,
  ModuleResolutionError,
  type ToolRegistry,
  type Resolution,
} from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import {
  getDefaultSubprocessAdapter,
  type SubprocessAdapter,
} from "@blackbelt-technology/pi-dashboard-shared/platform/subprocess-adapter.js";

/**
 * Resolve a command name through the tool registry's executor API.
 * If the name is registered (e.g. "npm", "openspec", "pi"), returns
 * the full executor argv — on Windows this is `[node.exe, <script>.js]`
 * bypassing .cmd shims. Otherwise returns `[command, ...args]` verbatim
 * so callers fall through to buildSafeArgv's generic handling.
 *
 * See change: consolidate-windows-spawn-and-platform-handlers.
 */
function resolveViaRegistry(
  registry: ToolRegistry,
  command: string,
  args: readonly string[],
): string[] {
  if (registry.has(command)) {
    const exec = registry.resolveExecutor(command);
    if (exec.ok && exec.argv.length > 0) {
      return [...exec.argv, ...args];
    }
  }
  return [command, ...args];
}

/**
 * Subclass of pi's `DefaultPackageManager` that routes every subprocess
 * through our OS-aware `SubprocessAdapter`. Pi's upstream implementation
 * spawns with `shell: process.platform === "win32"` and no `windowsHide`,
 * which on Windows triggers Node issue #21825 — flashing cmd console
 * every time pi shells out to npm / git / etc.
 *
 * This class overrides the three spawn methods pi exposes on its own
 * class (`spawnCommand`, `spawnCaptureCommand`, `runCommandSync`) and
 * delegates them to the adapter. Other methods inherit unchanged;
 * pi's internal `runCommand` / `runCommandCapture` call the overridden
 * methods via `this.spawnCommand(...)` so they pick up the safe
 * behaviour automatically.
 *
 * Constructor factory takes the base `DefaultPackageManager` class as
 * input so we can extend it dynamically at runtime (pi is loaded via
 * the tool registry's `resolveModule`, not a static import).
 *
 * See change: consolidate-windows-spawn-and-platform-handlers.
 */
function createSafePackageManagerClass(
  BaseClass: new (...args: any[]) => any,
  adapter: SubprocessAdapter,
  registry: ToolRegistry,
): new (...args: any[]) => any {
  return class SafePackageManager extends BaseClass {
    // `spawnCommand` — used by pi for fire-and-forget installs where
    // stdout/stderr are inherited (or piped for capture). Returns the
    // live ChildProcess.
    //
    // Registry resolution: `command` arrives as "npm" / "git" etc.
    // For registered executor tools this becomes `[node.exe, cli.js]`
    // on Windows, bypassing .cmd entirely.
    spawnCommand(command: string, args: readonly string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
      const [cmd, ...finalArgs] = resolveViaRegistry(registry, command, args);
      return adapter.spawn(cmd, finalArgs, {
        cwd: options?.cwd,
        stdio: "inherit",
      });
    }

    // `spawnCaptureCommand` — used by pi when it wants to read stdout /
    // stderr programmatically (e.g. `npm root -g`, `npm view <pkg>`).
    spawnCaptureCommand(command: string, args: readonly string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
      const [cmd, ...finalArgs] = resolveViaRegistry(registry, command, args);
      return adapter.spawn(cmd, finalArgs, {
        cwd: options?.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: options?.env ? { ...process.env, ...options.env } : process.env,
      });
    }

    // `runCommandSync` — used for quick synchronous checks.
    runCommandSync(command: string, args: readonly string[]) {
      const [cmd, ...finalArgs] = resolveViaRegistry(registry, command, args);
      const result = adapter.spawnSync<string>(cmd, finalArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf-8",
      });
      if (result.status !== 0) {
        const stderr = typeof result.stderr === "string" ? result.stderr : String(result.stderr ?? "");
        const stdout = typeof result.stdout === "string" ? result.stdout : String(result.stdout ?? "");
        throw new Error(`Failed to run ${command} ${args.join(" ")}: ${stderr || stdout}`);
      }
      const stdout = typeof result.stdout === "string" ? result.stdout : String(result.stdout ?? "");
      return stdout.trim();
    }
  };
}

export interface ProgressEvent {
  type: "start" | "progress" | "complete" | "error";
  action: "install" | "remove" | "update" | "clone" | "pull";
  source: string;
  message?: string;
}

/** Pi-coding-agent's public surface, as consumed by this wrapper. */
interface PiModule {
  DefaultPackageManager: any;
  SettingsManager: any;
}

/**
 * Resolve pi's package-manager API via the ToolRegistry. Surface the
 * diagnostic trail on failure so callers (routes) can show the real
 * reason instead of a generic "not installed" message.
 */
async function loadPiPackageManager(registry: ToolRegistry = getDefaultRegistry()): Promise<PiModule> {
  const { module } = await registry.resolveModule<PiModule>("pi-coding-agent");
  if (!module.DefaultPackageManager) {
    throw new Error(
      "pi-coding-agent resolved but does not export DefaultPackageManager (unexpected package version)",
    );
  }
  return module;
}

/** Debug helper: expose the raw Resolution for diagnostic surfaces. */
export function diagnosePiPackageManager(registry: ToolRegistry = getDefaultRegistry()): Resolution {
  return registry.resolve("pi-coding-agent");
}

/** Re-export so route handlers can `instanceof`-check for the rich error. */
export { ModuleResolutionError };

export type PackageScope = "global" | "local";
export type PackageAction = "install" | "remove" | "update";

export interface OperationRequest {
  action: PackageAction;
  source: string;
  scope: PackageScope;
  cwd?: string;
}

export interface OperationResult {
  operationId: string;
  action: PackageAction;
  source: string;
  scope: PackageScope;
  success: boolean;
  error?: string;
  /** On failure: full resolution trail if pi couldn't be loaded. */
  diagnostics?: Resolution;
}

export type ProgressListener = (operationId: string, event: ProgressEvent) => void;
export type CompleteListener = (result: OperationResult) => void;

const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");

export class PackageManagerWrapper {
  private busy = false;
  private onProgress: ProgressListener | undefined;
  private onComplete: CompleteListener | undefined;
  /** Called after successful operation; returns number of sessions reloaded. */
  private reloadSessions: (() => Promise<number>) | undefined;
  private readonly registry: ToolRegistry;

  constructor(registry: ToolRegistry = getDefaultRegistry()) {
    this.registry = registry;
  }

  setProgressListener(listener: ProgressListener | undefined) {
    this.onProgress = listener;
  }

  setCompleteListener(listener: CompleteListener | undefined) {
    this.onComplete = listener;
  }

  setReloadSessions(fn: (() => Promise<number>) | undefined) {
    this.reloadSessions = fn;
  }

  isBusy(): boolean {
    return this.busy;
  }

  /**
   * Start a package operation. Returns the operationId immediately.
   * Progress and completion are delivered via listeners.
   * Throws if another operation is already running.
   */
  async run(req: OperationRequest): Promise<string> {
    if (this.busy) {
      throw new PackageOperationBusyError();
    }

    const operationId = crypto.randomUUID();
    this.busy = true;

    // Run async — don't await here so caller gets operationId immediately
    this.executeOperation(operationId, req).catch(() => {
      // errors handled inside executeOperation
    });

    return operationId;
  }

  /**
   * List configured packages for a scope.
   */
  async listInstalled(scope: PackageScope, cwd?: string) {
    const pm = await this.createPackageManager(cwd);
    const all = pm.listConfiguredPackages();
    const scopeFilter = scope === "global" ? "user" : "project";
    return all.filter((p: any) => p.scope === scopeFilter);
  }

  /**
   * Check for available updates. Returns packages that have updates.
   */
  async checkUpdates(cwd?: string) {
    const pm = await this.createPackageManager(cwd);
    return pm.checkForAvailableUpdates();
  }

  // ── Internal ────────────────────────────────────────────────────

  /**
   * Per-cwd cache of DefaultPackageManager instances. Each instance holds
   * its own SettingsManager + filesystem state; on Windows
   * `listConfiguredPackages` can take several seconds on cold
   * instantiation, so reusing the same instance across repeat calls
   * (same cwd) eliminates the cost of the `/api/packages/recommended` +
   * `/api/packages/installed` flows firing back-to-back.
   *
   * We also dedupe *in-flight* instantiations via `pmPending`: if two
   * concurrent callers both ask for the same cwd before the first
   * instantiation resolves, they share the same Promise instead of
   * spawning parallel `DefaultPackageManager` constructions (which
   * compete for the event loop and can double cold-start latency).
   *
   * `run()` invalidates the relevant entry after an install/remove/update
   * so stale state never persists past a mutation.
   */
  private readonly pmCache = new Map<string, unknown>();
  private readonly pmPending = new Map<string, Promise<unknown>>();

  private async createPackageManager(cwd?: string) {
    const effectiveCwd = cwd ?? process.cwd();
    const cached = this.pmCache.get(effectiveCwd);
    if (cached) return cached as any;
    const inflight = this.pmPending.get(effectiveCwd);
    if (inflight) return inflight as any;

    const promise = (async () => {
      const { DefaultPackageManager, SettingsManager } = await loadPiPackageManager(this.registry);
      const settingsManager = SettingsManager.create(effectiveCwd, AGENT_DIR);
      // Wrap pi's DefaultPackageManager in our SafePackageManager so
      // every internal `spawn` / `spawnSync` / `runCommandSync` call
      // routes through the OS-aware SubprocessAdapter. This is THE
      // fix for cmd.exe flashes on Windows caused by pi's upstream
      // `shell: true + no windowsHide` spawn pattern.
      const SafePM = createSafePackageManagerClass(
        DefaultPackageManager,
        getDefaultSubprocessAdapter(),
        this.registry,
      );
      const pm = new SafePM({ cwd: effectiveCwd, agentDir: AGENT_DIR, settingsManager });
      this.pmCache.set(effectiveCwd, pm);
      return pm;
    })();
    this.pmPending.set(effectiveCwd, promise);
    try {
      return await promise;
    } finally {
      this.pmPending.delete(effectiveCwd);
    }
  }

  /** Drop the cached package manager for a cwd (after install/remove/update). */
  private invalidatePackageManager(cwd?: string): void {
    const effectiveCwd = cwd ?? process.cwd();
    this.pmCache.delete(effectiveCwd);
    this.pmPending.delete(effectiveCwd);
  }

  private async executeOperation(operationId: string, req: OperationRequest): Promise<void> {
    const result: OperationResult = {
      operationId,
      action: req.action,
      source: req.source,
      scope: req.scope,
      success: false,
    };

    try {
      const pm = await this.createPackageManager(req.cwd);
      const local = req.scope === "local";

      pm.setProgressCallback((event: ProgressEvent) => {
        this.onProgress?.(operationId, event);
      });

      switch (req.action) {
        case "install":
          await pm.installAndPersist(req.source, { local });
          break;
        case "remove":
          await pm.removeAndPersist(req.source, { local });
          break;
        case "update":
          await pm.update(req.source || undefined);
          break;
      }

      result.success = true;

      // Invalidate the cached package manager for this cwd so future
      // listInstalled() calls see the mutated settings.json.
      this.invalidatePackageManager(req.cwd);

      // Reload all sessions after successful operation
      if (this.reloadSessions) {
        try {
          const count = await this.reloadSessions();
          (result as any).sessionsReloaded = count;
        } catch (err) {
          console.error("[package-manager] session reload failed:", err);
        }
      }
    } catch (err: any) {
      // Pi-not-found: surface the full Resolution trail to the caller
      // so the UI can render per-strategy failure reasons instead of
      // the old opaque "pi-coding-agent is not installed" message.
      if (err instanceof ModuleResolutionError) {
        result.error = err.message;
        result.diagnostics = err.resolution;
      } else {
        result.error = err?.message ?? String(err);
      }
    } finally {
      this.busy = false;
      this.onComplete?.(result);
    }
  }
}

export class PackageOperationBusyError extends Error {
  constructor() {
    super("A package operation is already in progress");
    this.name = "PackageOperationBusyError";
  }
}
