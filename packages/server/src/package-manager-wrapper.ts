/**
 * Thin adapter around pi's DefaultPackageManager.
 * Serializes operations (one at a time), forwards progress events,
 * and triggers session reload on success.
 */
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import * as npm from "@blackbelt-technology/pi-dashboard-shared/platform/npm.js";
export interface ProgressEvent {
  type: "start" | "progress" | "complete" | "error";
  action: "install" | "remove" | "update" | "clone" | "pull";
  source: string;
  message?: string;
}

/** Lazily import pi's PackageManager (optional peer dependency). */
let piModuleCache: { DefaultPackageManager: any; SettingsManager: any } | null = null;

async function loadPiPackageManager() {
  if (piModuleCache) return piModuleCache;

  // Try direct import first (works if installed as a dependency)
  try {
    const mod = await import("@mariozechner/pi-coding-agent") as any;
    if (mod.DefaultPackageManager) {
      piModuleCache = { DefaultPackageManager: mod.DefaultPackageManager, SettingsManager: mod.SettingsManager };
      return piModuleCache;
    }
  } catch { /* fall through to global resolution */ }

  // Try managed install at ~/.pi-dashboard/node_modules/ (Electron portable/standalone)
  const managedDir = path.join(os.homedir(), ".pi-dashboard");
  for (const pkgName of ["@mariozechner/pi-coding-agent", "@oh-my-pi/pi-coding-agent"]) {
    try {
      const entryPath = path.join(managedDir, "node_modules", pkgName, "dist", "index.js");
      const mod = await import(pathToFileURL(entryPath).href);
      if (mod.DefaultPackageManager) {
        piModuleCache = { DefaultPackageManager: mod.DefaultPackageManager, SettingsManager: mod.SettingsManager };
        return piModuleCache;
      }
    } catch { /* fall through */ }
  }

  // Resolve from global npm install (pi is typically installed globally)
  for (const pkgName of ["@mariozechner/pi-coding-agent", "@oh-my-pi/pi-coding-agent"]) {
    try {
      const npmRoot = npm.rootGlobalOr("");
      if (!npmRoot) throw new Error("npm root -g failed");
      const entryPath = path.join(npmRoot, pkgName, "dist", "index.js");
      const mod = await import(pathToFileURL(entryPath).href);
      if (mod.DefaultPackageManager) {
        piModuleCache = { DefaultPackageManager: mod.DefaultPackageManager, SettingsManager: mod.SettingsManager };
        return piModuleCache;
      }
    } catch { /* fall through */ }
  }

  throw new Error(
    "pi-coding-agent is not installed. Package management requires pi to be installed (globally or as a dependency)."
  );
}

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

  private async createPackageManager(cwd?: string) {
    const { DefaultPackageManager, SettingsManager } = await loadPiPackageManager();
    const effectiveCwd = cwd ?? process.cwd();
    const settingsManager = SettingsManager.create(effectiveCwd, AGENT_DIR);
    return new DefaultPackageManager({ cwd: effectiveCwd, agentDir: AGENT_DIR, settingsManager });
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
      result.error = err?.message ?? String(err);
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
