/**
 * Thin adapter around pi's DefaultPackageManager.
 * Serializes operations (one at a time), forwards progress events,
 * and triggers session reload on success.
 *
 * Pi module resolution is delegated to the shared `ToolRegistry`
 * (`resolveModule("pi-coding-agent")`). All strategy chains, caching,
 * and diagnostic trails live there — see change: consolidate-tool-resolution.
 */

import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import {
  getDefaultSubprocessAdapter,
  type SubprocessAdapter,
} from "@blackbelt-technology/pi-dashboard-shared/platform/subprocess-adapter.js";
import {
  getDefaultRegistry,
  ModuleResolutionError,
  type Resolution,
  type ToolRegistry,
} from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { computeIdentity, parseSourceKind } from "./package-source-helpers.js";

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
export type PackageAction = "install" | "remove" | "update" | "move" | "reset";

export interface OperationRequest {
  action: "install" | "remove" | "update";
  source: string;
  scope: PackageScope;
  cwd?: string;
}

/**
 * Pi `packages[]` entry. Either a bare source string or an object with
 * filter keys (`extensions`/`skills`/`prompts`/`themes`). See pi's
 * `docs/packages.md` “Package Filtering” section.
 */
export type PackageEntry = string | { source: string; [k: string]: unknown };

/**
 * Reset-to-npm operation request. Install `publishedSource` (`npm:<name>`)
 * FIRST, then remove the local/git `source` entry — both in the same scope.
 * See change: reset-override-to-npm.
 */
export interface ResetRequest {
	/** The local/git `packages[]` entry to drop after a successful install. */
	source: string;
	/** The canonical published spec to install (`npm:<name>` or git URL). */
	publishedSource: string;
	scope: PackageScope;
	/** Required when scope is local. */
	cwd?: string;
}

/** Move operation request. See change: unify-package-management-ui. */
export interface MoveRequest {
  /** Full origin entry (string or filter object) — passed verbatim from the route. */
  entry: PackageEntry;
  fromScope: PackageScope;
  fromCwd?: string;
  toScope: PackageScope;
  toCwd?: string;
}

export interface OperationResult {
  operationId: string;
  /** `move` for composite move ops; `install`/`remove`/`update` otherwise. */
  action: PackageAction;
  /** When `action === "move"`, this is the destination scope. */
  scope: PackageScope;
  source: string;
  success: boolean;
  error?: string;
  /** Set on `action === "move"` only; ties together emitted events. */
  moveId?: string;
  /** Set on `action === "move"` when install succeeded but remove failed. */
  partialSuccess?: {
    installed: boolean;
    removed: boolean;
    removeError?: string;
  };
  /** On failure: full resolution trail if pi couldn't be loaded. */
  diagnostics?: Resolution;
}

export type ProgressListener = (operationId: string, event: ProgressEvent, moveId?: string) => void;
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
   * Run an arbitrary async operation under the wrapper's busy-lock.
   * Used by adjacent subsystems (e.g. PiCoreUpdater) to coordinate with
   * extension install/update operations. Throws PackageOperationBusyError
   * if a package operation is already running.
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busy) {
      throw new PackageOperationBusyError();
    }
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
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
   * Move a package between scopes (global ↔ local). Hybrid execution:
   *
   *   - npm:/git:/https: → install at destination, then remove from origin.
   *   - abs-path/rel-path → settings-only edit (pi never copies path sources).
   *
   * Returns moveId synchronously. Single-flight via `this.busy`.
   * Throws synchronously: `PackageOperationBusyError`,
   * `InvalidMoveRequestError`, `UnsupportedSourceForDestinationError`.
   * Throws async (caught by executeMove): `AlreadyAtDestinationError`
   * is delivered via the complete listener with success=false.
   *
   * See change: unify-package-management-ui.
   */
  async move(req: MoveRequest): Promise<string> {
    if (this.busy) {
      throw new PackageOperationBusyError();
    }

    if (req.fromScope === req.toScope) {
      throw new InvalidMoveRequestError("fromScope and toScope must differ");
    }
    if (req.fromScope === "local" && !req.fromCwd) {
      throw new InvalidMoveRequestError("fromCwd required when fromScope is local");
    }
    if (req.toScope === "local" && !req.toCwd) {
      throw new InvalidMoveRequestError("toCwd required when toScope is local");
    }

    const sourceStr = typeof req.entry === "string" ? req.entry : req.entry.source;
    if (!sourceStr || typeof sourceStr !== "string") {
      throw new InvalidMoveRequestError("entry.source must be a non-empty string");
    }
    if (parseSourceKind(sourceStr) === "rel-path" && req.fromScope === "local" && !req.fromCwd) {
      throw new UnsupportedSourceForDestinationError("relative-path source requires fromCwd");
    }

    const moveId = crypto.randomUUID();
    this.busy = true;
    this.executeMove(moveId, req).catch(() => {
      // errors handled inside executeMove
    });
    return moveId;
  }

  /**
   * Reset a source-override package back to its canonical published spec.
   * Install `publishedSource` FIRST; only on success remove the local/git
   * `source` entry — both in the same scope. Modeled on `move()` (install-
   * new + remove-old), swapping source-kind instead of scope.
   *
   * Returns resetId synchronously. Single-flight via `this.busy`. Emits
   * exactly one `package_operation_complete` with `action: "reset"` and
   * `moveId = resetId` (reuses the composite-op grouping + partial-success
   * protocol so the client move-tracker path consumes it unchanged).
   * See change: reset-override-to-npm.
   */
  async reset(req: ResetRequest): Promise<string> {
    if (this.busy) {
      throw new PackageOperationBusyError();
    }
    if (!req.source || typeof req.source !== "string") {
      throw new InvalidResetRequestError("source must be a non-empty string");
    }
    if (!req.publishedSource || typeof req.publishedSource !== "string") {
      throw new InvalidResetRequestError("publishedSource must be a non-empty string");
    }
    if (req.scope === "local" && !req.cwd) {
      throw new InvalidResetRequestError("cwd required when scope is local");
    }

    const resetId = crypto.randomUUID();
    this.busy = true;
    this.executeReset(resetId, req).catch(() => {
      // errors handled inside executeReset
    });
    return resetId;
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

  private async executeOperation(operationId: string, req: OperationRequest, moveId?: string): Promise<void> {
    const result: OperationResult = {
      operationId,
      action: req.action,
      source: req.source,
      scope: req.scope,
      success: false,
      moveId,
    };

    try {
      const pm = await this.createPackageManager(req.cwd);
      const local = req.scope === "local";

      pm.setProgressCallback((event: ProgressEvent) => {
        this.onProgress?.(operationId, event, moveId);
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

      // Reload all sessions. When called inside a move (moveId set),
      // skip — executeMove issues exactly one reload at the very end.
      if (this.reloadSessions && !moveId) {
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
      // Re-throw so executeMove can detect failure and short-circuit.
      if (moveId) throw err;
    } finally {
      // When inside a move the busy lock is held by executeMove —
      // do NOT release it here. Don't fire the completion listener
      // either — executeMove emits a single composite "move" event.
      if (!moveId) {
        this.busy = false;
        this.onComplete?.(result);
      }
    }
  }

  /**
   * Execute a reset. Holds the busy lock across both phases. Install-first;
   * on install failure the local entry is left intact and the op reports
   * failure. On remove failure after a good install it reports partial
   * success. Emits exactly one complete event with `action: "reset"`.
   */
  private async executeReset(resetId: string, req: ResetRequest): Promise<void> {
    const result: OperationResult = {
      operationId: resetId,
      action: "reset",
      source: req.source,
      scope: req.scope,
      success: false,
      moveId: resetId,
    };

    try {
      // Phase 1: install the published spec. Throws on failure (moveId set),
      // which short-circuits to catch — the local entry is never removed.
      const installReq: OperationRequest = {
        action: "install",
        source: req.publishedSource,
        scope: req.scope,
        cwd: req.scope === "local" ? req.cwd : undefined,
      };
      await this.executeOperation(crypto.randomUUID(), installReq, resetId);

      // Phase 2: remove the local/git entry. Failure → partial success.
      try {
        const removeReq: OperationRequest = {
          action: "remove",
          source: req.source,
          scope: req.scope,
          cwd: req.scope === "local" ? req.cwd : undefined,
        };
        await this.executeOperation(crypto.randomUUID(), removeReq, resetId);
      } catch (removeErr: any) {
        result.partialSuccess = {
          installed: true,
          removed: false,
          removeError: removeErr?.message ?? String(removeErr),
        };
      }

      result.success = true;
      this.invalidatePackageManager(req.cwd);

      if (this.reloadSessions) {
        try {
          const count = await this.reloadSessions();
          (result as any).sessionsReloaded = count;
        } catch (err) {
          console.error("[package-manager] session reload failed:", err);
        }
      }
    } catch (err: any) {
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

  /**
   * Execute a move. Holds the busy lock across both phases. Emits exactly
   * one `package_operation_complete` listener call with `action: "move"`.
   */
  private async executeMove(moveId: string, req: MoveRequest): Promise<void> {
    const sourceStr = typeof req.entry === "string" ? req.entry : req.entry.source;
    const result: OperationResult = {
      operationId: moveId,
      action: "move",
      source: sourceStr,
      scope: req.toScope,
      success: false,
      moveId,
    };

    const pmCwd = req.toCwd ?? req.fromCwd ?? process.cwd();

    try {
      const pm = await this.createPackageManager(pmCwd);
      const settingsManager = (pm as any).settingsManager;
      if (!settingsManager) {
        throw new Error("pi DefaultPackageManager does not expose settingsManager (unexpected pi version)");
      }

      // Identity preflight against destination's packages[].
      const destPackages = readPackages(settingsManager, req.toScope);
      const toSettingsDir = req.toScope === "global"
        ? path.join(os.homedir(), ".pi", "agent")
        : path.join(req.toCwd ?? pmCwd, ".pi");
      const fromSettingsDir = req.fromScope === "global"
        ? path.join(os.homedir(), ".pi", "agent")
        : path.join(req.fromCwd ?? pmCwd, ".pi");
      const incomingIdentity = computeIdentity(sourceStr, fromSettingsDir);
      const dup = destPackages.find((e) => {
        const s = typeof e === "string" ? e : e?.source;
        return s ? computeIdentity(s, toSettingsDir) === incomingIdentity : false;
      });
      if (dup) throw new AlreadyAtDestinationError(sourceStr, req.toScope);

      const kind = parseSourceKind(sourceStr);
      const isPathArm = kind === "abs-path" || kind === "rel-path";

      pm.setProgressCallback((event: ProgressEvent) => {
        this.onProgress?.(moveId, { ...event, action: "move" as any }, moveId);
      });

      if (isPathArm) {
        // Path arm: settings-only edit, no file copy.
        const fromPackages = readPackages(settingsManager, req.fromScope);
        const fromIdx = fromPackages.findIndex((e) => {
          const s = typeof e === "string" ? e : e?.source;
          return s && computeIdentity(s, fromSettingsDir) === incomingIdentity;
        });
        if (fromIdx < 0) {
          throw new Error(`source not found in ${req.fromScope} packages[]`);
        }
        const originEntry = fromPackages[fromIdx];
        const newSource = translatePathSource({
          originalSource: sourceStr,
          fromSettingsDir,
          toSettingsDir,
          toScope: req.toScope,
        });
        const newEntry: PackageEntry = typeof originEntry === "string"
          ? newSource
          : { ...originEntry, source: newSource };

        writePackages(settingsManager, req.toScope, [...destPackages, newEntry]);
        writePackages(settingsManager, req.fromScope, fromPackages.filter((_, i) => i !== fromIdx));
      } else {
        // npm/git/https arm: install at dest, then remove from origin.
        const installReq: OperationRequest = {
          action: "install",
          source: sourceStr,
          scope: req.toScope,
          cwd: req.toScope === "local" ? req.toCwd : undefined,
        };
        await this.executeOperation(crypto.randomUUID(), installReq, moveId);

        // Filter-preservation: if origin had filters (object form), patch
        // the destination entry pi just wrote so they survive the move.
        if (typeof req.entry === "object" && req.entry !== null) {
          const finalDest = readPackages(settingsManager, req.toScope);
          const idx = finalDest.findIndex((e) => {
            const s = typeof e === "string" ? e : e?.source;
            return s && computeIdentity(s, toSettingsDir) === incomingIdentity;
          });
          if (idx >= 0) {
            const installedEntry = finalDest[idx];
            const installedSource = typeof installedEntry === "string"
              ? installedEntry
              : installedEntry.source;
            finalDest[idx] = { ...req.entry, source: installedSource };
            writePackages(settingsManager, req.toScope, finalDest);
          }
        }

        // Remove from origin. Failure → partial-success, not full failure.
        try {
          const removeReq: OperationRequest = {
            action: "remove",
            source: sourceStr,
            scope: req.fromScope,
            cwd: req.fromScope === "local" ? req.fromCwd : undefined,
          };
          await this.executeOperation(crypto.randomUUID(), removeReq, moveId);
        } catch (removeErr: any) {
          result.partialSuccess = {
            installed: true,
            removed: false,
            removeError: removeErr?.message ?? String(removeErr),
          };
        }
      }

      result.success = true;
      this.invalidatePackageManager(req.fromCwd);
      this.invalidatePackageManager(req.toCwd);

      if (this.reloadSessions) {
        try {
          const count = await this.reloadSessions();
          (result as any).sessionsReloaded = count;
        } catch (err) {
          console.error("[package-manager] session reload failed:", err);
        }
      }
    } catch (err: any) {
      if (err instanceof ModuleResolutionError) {
        result.error = err.message;
        result.diagnostics = err.resolution;
      } else if (err instanceof AlreadyAtDestinationError) {
        result.error = err.message;
        (result as any).code = "already_at_destination";
      } else {
        result.error = err?.message ?? String(err);
      }
    } finally {
      this.busy = false;
      this.onComplete?.(result);
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// SettingsManager helpers — thin shim around pi's API.
// ──────────────────────────────────────────────────────────────────

function readPackages(settingsManager: any, scope: PackageScope): PackageEntry[] {
  const settings = scope === "global"
    ? settingsManager.getGlobalSettings?.()
    : settingsManager.getProjectSettings?.();
  return Array.isArray(settings?.packages) ? [...settings.packages] : [];
}

function writePackages(settingsManager: any, scope: PackageScope, packages: PackageEntry[]): void {
  if (scope === "global") {
    if (typeof settingsManager.setPackages !== "function") {
      throw new Error("settingsManager.setPackages not available (unexpected pi version)");
    }
    settingsManager.setPackages(packages);
  } else {
    if (typeof settingsManager.setProjectPackages !== "function") {
      throw new Error("settingsManager.setProjectPackages not available (unexpected pi version)");
    }
    settingsManager.setProjectPackages(packages);
  }
}

/**
 * Translate a path source between scopes per design.md decision 1.
 * To global → resolve to absolute against fromSettingsDir.
 * To local  → try path.relative(toSettingsDir, abs); keep absolute if
 * the relative form escapes the cwd tree by more than 2 `..` segments.
 */
export function translatePathSource(args: {
  originalSource: string;
  fromSettingsDir: string;
  toSettingsDir: string;
  toScope: PackageScope;
}): string {
  const { originalSource, fromSettingsDir, toSettingsDir, toScope } = args;
  const abs = path.isAbsolute(originalSource)
    ? path.normalize(originalSource)
    : path.resolve(fromSettingsDir, originalSource);

  if (toScope === "global") return abs;

  const rel = path.relative(toSettingsDir, abs);
  if (rel === "") return ".";
  const upSegments = rel.split(path.sep).filter((s) => s === "..").length;
  if (upSegments > 2) return abs;
  return rel;
}

export class AlreadyAtDestinationError extends Error {
  constructor(public source: string, public destScope: PackageScope) {
    super(`Package already installed at ${destScope} scope: ${source}`);
    this.name = "AlreadyAtDestinationError";
  }
}

export class InvalidResetRequestError extends Error {
  constructor(reason: string) {
    super(`Invalid reset request: ${reason}`);
    this.name = "InvalidResetRequestError";
  }
}

export class InvalidMoveRequestError extends Error {
  constructor(reason: string) {
    super(`Invalid move request: ${reason}`);
    this.name = "InvalidMoveRequestError";
  }
}

export class UnsupportedSourceForDestinationError extends Error {
  constructor(reason: string) {
    super(`Unsupported source for destination: ${reason}`);
    this.name = "UnsupportedSourceForDestinationError";
  }
}

export class PackageOperationBusyError extends Error {
  constructor() {
    super("A package operation is already in progress");
    this.name = "PackageOperationBusyError";
  }
}
