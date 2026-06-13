/**
 * Server-side lifecycle manager for code-server child processes.
 *
 * Spawning is delegated to the editor keeper sidecar (see
 * `editor-keeper/keeper-manager.ts`). `start(cwd)` is a 3-way resolution:
 *   1. existing in-memory instance for cwd → return,
 *   2. live keeper sidecar for cwd → reattach,
 *   3. else spawn a fresh keeper.
 *
 * `editorId = sha256(cwd).slice(0,12)` and is stable across restarts so the
 * `/editor/<id>/` proxy URL survives a dashboard restart.
 *
 * See: openspec/changes/add-editor-keeper-sidecar
 */
import { Socket as NetSocket, createServer as createNetServer } from "node:net";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { EditorInstanceStatus, EditorDetectionResult } from "@blackbelt-technology/pi-dashboard-shared/editor-types.js";
import type { EditorConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { detectCodeServerBinary, resetDetectionCache } from "./editor-detection.js";
import { buildSpawnEnv } from "./process-manager.js";
import type { EditorPidRegistry } from "./editor-pid-registry.js";
import {
  createEditorKeeperManager,
  editorIdFromCwd,
  type EditorKeeperManager,
} from "./editor-keeper/keeper-manager.js";

export interface EditorInstanceInfo {
  id: string;
  cwd: string;
  port: number;
  status: EditorInstanceStatus;
  proxyPath: string;
}

interface InternalInstance {
  id: string;
  cwd: string;
  port: number;
  status: EditorInstanceStatus;
  lastHeartbeat: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  childExitDispose: (() => void) | null;
}

export interface EditorManagerOptions {
  config: EditorConfig;
  detection: EditorDetectionResult;
  onStatusChange?: (cwd: string, id: string, status: EditorInstanceStatus) => void;
  allowRedetection?: boolean;
  /** Legacy persistent PID registry — retained for boot-time orphan sweep only. */
  pidRegistry?: EditorPidRegistry;
  /** Override the keeper-manager (testing). */
  keeperManager?: EditorKeeperManager;
}

export interface EditorManager {
  start(cwd: string, theme?: "dark" | "light"): Promise<EditorInstanceInfo>;
  stop(id: string): Promise<void>;
  heartbeat(id: string): void;
  setTheme(cwd: string, theme: "dark" | "light"): void;
  get(id: string): EditorInstanceInfo | undefined;
  getByFolder(cwd: string): EditorInstanceInfo | undefined;
  list(): EditorInstanceInfo[];
  /** Config-gated. No-op against keepers when `stopOnDashboardExit` is false. */
  stopAll(): Promise<void>;
  /** Tests only — unconditionally signal every keeper, bypassing the flag. */
  forceStopAll(): Promise<void>;
  /** Register an editor adopted from a surviving keeper sidecar on boot. */
  adopt(info: { editorId: string; cwd: string; port: number }): EditorInstanceInfo;
}

/** Allocate a free port by binding to port 0. */
export async function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close();
        return reject(new Error("Failed to allocate port"));
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/** Probe a TCP port until it accepts connections or timeout. */
export async function waitForPort(port: number, timeoutMs = 15000, intervalMs = 200): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = new NetSocket();
      socket.setTimeout(intervalMs);
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => { socket.destroy(); resolve(false); });
      socket.once("timeout", () => { socket.destroy(); resolve(false); });
      socket.connect(port, "127.0.0.1");
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function folderHash(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 12);
}

const DEFAULT_DARK_THEME = "Default Dark Modern";
const DEFAULT_LIGHT_THEME = "Default Light Modern";

function writeVscodeUserSettings(dataDir: string, theme: "dark" | "light" = "dark"): void {
  const userDir = path.join(dataDir, "User");
  mkdirSync(userDir, { recursive: true });

  const settingsPath = path.join(userDir, "settings.json");

  let existing: Record<string, unknown> = {};
  try {
    if (existsSync(settingsPath)) {
      existing = JSON.parse(readFileSync(settingsPath, "utf-8"));
    }
  } catch { /* ignore parse errors */ }

  const darkTheme = (existing["workbench.preferredDarkColorTheme"] as string) ?? DEFAULT_DARK_THEME;
  const lightTheme = (existing["workbench.preferredLightColorTheme"] as string) ?? DEFAULT_LIGHT_THEME;

  // Persistence-friendly defaults seeded only when absent: existing user
  // values win (spread last), theme keys stay authoritative (set explicitly
  // by the dashboard each spawn).
  const settings = {
    "window.restoreWindows": "all",
    "workbench.editor.restoreViewState": true,
    "files.hotExit": "onExitAndWindowClose",
    "security.workspace.trust.enabled": false,
    "update.mode": "none",
    "extensions.autoCheckUpdates": false,
    "workbench.startupEditor": "none",
    ...existing,
    "window.autoDetectColorScheme": false,
    "workbench.preferredDarkColorTheme": darkTheme,
    "workbench.preferredLightColorTheme": lightTheme,
    "workbench.colorTheme": theme === "light" ? lightTheme : darkTheme,
  };

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

function toInfo(inst: InternalInstance): EditorInstanceInfo {
  return {
    id: inst.id,
    cwd: inst.cwd,
    port: inst.port,
    status: inst.status,
    proxyPath: `/editor/${inst.id}/`,
  };
}

/** Grace timer for a keeper that won't emit child_exit. */
const STOP_FALLBACK_MS = 6000;

export function createEditorManager(options: EditorManagerOptions): EditorManager {
  const { config, detection, onStatusChange, allowRedetection = true } = options;
  const keeperManager = options.keeperManager ?? createEditorKeeperManager();
  const instances = new Map<string, InternalInstance>();
  const cwdIndex = new Map<string, string>(); // cwd → id
  const idleTimeoutMs = (config.idleTimeoutMinutes ?? 10) * 60 * 1000;
  const maxInstances = config.maxInstances ?? 3;

  function setStatus(inst: InternalInstance, status: EditorInstanceStatus) {
    inst.status = status;
    onStatusChange?.(inst.cwd, inst.id, status);
  }

  function clearIdleTimer(inst: InternalInstance) {
    if (inst.idleTimer) { clearTimeout(inst.idleTimer); inst.idleTimer = null; }
  }

  function startIdleTimer(inst: InternalInstance) {
    clearIdleTimer(inst);
    inst.idleTimer = setTimeout(() => { void stop(inst.id); }, idleTimeoutMs);
  }

  function cleanup(id: string) {
    const inst = instances.get(id);
    if (!inst) return;
    clearIdleTimer(inst);
    try { inst.childExitDispose?.(); } catch { /* ignore */ }
    inst.childExitDispose = null;
    cwdIndex.delete(inst.cwd);
    instances.delete(id);
  }

  async function evictOldestIdle(): Promise<boolean> {
    let oldest: InternalInstance | null = null;
    for (const inst of instances.values()) {
      if (inst.status !== "ready") continue;
      if (!oldest || inst.lastHeartbeat < oldest.lastHeartbeat) oldest = inst;
    }
    if (oldest) { await stop(oldest.id); return true; }
    return false;
  }

  function setTheme(cwd: string, theme: "dark" | "light"): void {
    const dataDir = path.join(os.homedir(), ".pi", "dashboard", "editors", folderHash(cwd));
    writeVscodeUserSettings(dataDir, theme);
  }

  function subscribeChildExit(inst: InternalInstance): void {
    inst.childExitDispose = keeperManager.onChildExit(inst.id, () => {
      if (inst.status !== "stopped") {
        console.log(`[editor-manager] keeper child_exit for ${inst.cwd}`);
        setStatus(inst, "stopped");
      }
      cleanup(inst.id);
    });
  }

  function registerInternal(args: {
    editorId: string;
    cwd: string;
    port: number;
    initialStatus: EditorInstanceStatus;
  }): InternalInstance {
    const inst: InternalInstance = {
      id: args.editorId,
      cwd: args.cwd,
      port: args.port,
      status: args.initialStatus,
      lastHeartbeat: Date.now(),
      idleTimer: null,
      childExitDispose: null,
    };
    instances.set(inst.id, inst);
    cwdIndex.set(inst.cwd, inst.id);
    return inst;
  }

  function adopt(info: { editorId: string; cwd: string; port: number }): EditorInstanceInfo {
    const existing = instances.get(info.editorId);
    if (existing) return toInfo(existing);
    const inst = registerInternal({
      editorId: info.editorId,
      cwd: info.cwd,
      port: info.port,
      initialStatus: "ready",
    });
    setStatus(inst, "ready");
    subscribeChildExit(inst);
    startIdleTimer(inst);
    return toInfo(inst);
  }

  // In-flight start dedup: concurrent start(cwd) calls (e.g. multiple browser
  // tabs/iframes opening the same folder, or post-restart heartbeat re-starts)
  // share one promise. Without this, two calls both miss `cwdIndex` before the
  // first registers, then both spawn a keeper for the same deterministic
  // editorId/dataDir → duplicate code-servers on one locked --user-data-dir =
  // stalled instance the manager can't cleanly stop.
  const inFlightStarts = new Map<string, Promise<EditorInstanceInfo>>();

  function start(cwd: string, theme?: "dark" | "light"): Promise<EditorInstanceInfo> {
    // Validate at the API boundary: a blank/whitespace cwd would create a
    // bogus dedup key and a doomed spawn. The REST route guards `!cwd`, but
    // whitespace-only values slip through, so normalize + reject here too.
    const normalizedCwd = typeof cwd === "string" ? cwd.trim() : "";
    if (!normalizedCwd) {
      return Promise.reject(new Error("cwd_required"));
    }
    const pending = inFlightStarts.get(normalizedCwd);
    if (pending) {
      if (theme) setTheme(normalizedCwd, theme);
      return pending;
    }
    const p = startInner(normalizedCwd, theme).finally(() => inFlightStarts.delete(normalizedCwd));
    inFlightStarts.set(normalizedCwd, p);
    return p;
  }

  async function startInner(cwd: string, theme?: "dark" | "light"): Promise<EditorInstanceInfo> {
    // 1. In-memory hit
    const existingId = cwdIndex.get(cwd);
    if (existingId) {
      const inst = instances.get(existingId);
      if (inst) {
        if (theme) setTheme(cwd, theme);
        if (inst.status === "starting") {
          const ready = await waitForPort(inst.port);
          if (ready && (inst.status as string) !== "stopped") {
            setStatus(inst, "ready");
            startIdleTimer(inst);
          }
        }
        return toInfo(inst);
      }
    }

    if (!detection.available || !detection.binary) {
      if (allowRedetection) {
        resetDetectionCache();
        const fresh = detectCodeServerBinary(config);
        detection.available = fresh.available;
        detection.binary = fresh.binary;
      }
      if (!detection.available || !detection.binary) {
        throw new Error("binary_not_found");
      }
    }

    // Capacity check before any I/O.
    if (instances.size >= maxInstances) {
      if (!(await evictOldestIdle())) {
        throw new Error("max_instances_reached");
      }
    }

    const editorId = editorIdFromCwd(cwd);
    const dataDir = path.join(os.homedir(), ".pi", "dashboard", "editors", editorId);

    // 2. Reattach via keeper probe.
    const probed = await keeperManager.probe(editorId).catch(() => ({ alive: false } as const));
    if (probed.alive && typeof probed.port === "number") {
      if (theme) setTheme(cwd, theme);
      const inst = registerInternal({ editorId, cwd, port: probed.port, initialStatus: "ready" });
      setStatus(inst, "ready");
      subscribeChildExit(inst);
      startIdleTimer(inst);
      return toInfo(inst);
    }

    // 3. Fresh spawn via keeper.
    const port = await allocatePort();
    writeVscodeUserSettings(dataDir, theme ?? "dark");

    const inst = registerInternal({ editorId, cwd, port, initialStatus: "starting" });
    setStatus(inst, "starting");

    const spawnResult = await keeperManager.spawnKeeperFor({
      cwd,
      port,
      binary: detection.binary,
      dataDir,
      env: buildSpawnEnv(),
    });
    if (!spawnResult.success) {
      setStatus(inst, "stopped");
      cleanup(inst.id);
      throw new Error(spawnResult.error ?? "keeper spawn failed");
    }

    // Wait until either the keeper's socket reports ready (status reply) OR
    // the port accepts a TCP connection — whichever first, within 15 s.
    const ready = await waitForKeeperReady(editorId, port);
    if (!ready) {
      await stop(inst.id);
      throw new Error("code-server failed to start within timeout");
    }

    setStatus(inst, "ready");
    subscribeChildExit(inst);
    startIdleTimer(inst);
    return toInfo(inst);
  }

  async function waitForKeeperReady(editorId: string, port: number): Promise<boolean> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      // Prefer the keeper socket probe (it answers as soon as code-server is up).
      const p = await keeperManager.probe(editorId).catch(() => ({ alive: false } as const));
      if (p.alive) return true;
      const portUp = await waitForPort(port, 250, 100);
      if (portUp) return true;
    }
    return false;
  }

  async function stop(id: string): Promise<void> {
    const inst = instances.get(id);
    if (!inst) return;

    clearIdleTimer(inst);
    setStatus(inst, "stopped");

    // Signal the keeper. If it dies cleanly, the child_exit listener calls
    // cleanup. Fallback timer reaps the entry if the keeper is unreachable.
    let cleanedUp = false;
    const cleanupOnce = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      cleanup(id);
    };

    const fallback = setTimeout(cleanupOnce, STOP_FALLBACK_MS);

    try {
      await keeperManager.writeCommand(id, { cmd: "stop" });
    } catch {
      // Keeper unreachable — fall through to fallback or direct kill.
    }

    // Replace the child_exit handler so cleanup fires once on either path.
    try { inst.childExitDispose?.(); } catch { /* ignore */ }
    inst.childExitDispose = keeperManager.onChildExit(id, () => {
      clearTimeout(fallback);
      cleanupOnce();
    });
  }

  function heartbeat(id: string) {
    const inst = instances.get(id);
    if (!inst) return;
    inst.lastHeartbeat = Date.now();
    if (inst.status === "ready") startIdleTimer(inst);
  }

  function get(id: string): EditorInstanceInfo | undefined {
    const inst = instances.get(id);
    return inst ? toInfo(inst) : undefined;
  }

  function getByFolder(cwd: string): EditorInstanceInfo | undefined {
    const id = cwdIndex.get(cwd);
    if (!id) return undefined;
    return get(id);
  }

  function list(): EditorInstanceInfo[] {
    return Array.from(instances.values()).map(toInfo);
  }

  async function signalAllStop(): Promise<void> {
    const ids = [...instances.keys()];
    await Promise.allSettled(
      ids.map(async (id) => {
        try {
          await keeperManager.writeCommand(id, { cmd: "stop" });
        } catch { /* ignore */ }
        // Wait up to 6 s for keeper's child_exit to fire cleanup, then force.
        const inst = instances.get(id);
        if (!inst) return;
        await new Promise<void>((resolve) => {
          const t = setTimeout(() => { resolve(); }, STOP_FALLBACK_MS);
          const dispose = keeperManager.onChildExit(id, () => {
            clearTimeout(t);
            try { dispose(); } catch { /* ignore */ }
            resolve();
          });
          // dispose stored on inst so cleanup() can tear it down if it fires first
          inst.childExitDispose = dispose;
        });
        cleanup(id);
      }),
    );
  }

  async function stopAll(): Promise<void> {
    // Config-gated. Default `false` → persistent editors survive dashboard
    // exit. Only signal keepers when the user has opted into stop-on-exit.
    if (!config.stopOnDashboardExit) {
      // Local in-memory cleanup only; do NOT signal keepers.
      for (const id of [...instances.keys()]) {
        const inst = instances.get(id);
        if (!inst) continue;
        clearIdleTimer(inst);
        try { inst.childExitDispose?.(); } catch { /* ignore */ }
        inst.childExitDispose = null;
        cwdIndex.delete(inst.cwd);
        instances.delete(id);
      }
      return;
    }
    await signalAllStop();
  }

  async function forceStopAll(): Promise<void> {
    await signalAllStop();
  }

  return {
    start,
    stop,
    heartbeat,
    setTheme,
    get,
    getByFolder,
    list,
    stopAll,
    forceStopAll,
    adopt,
  };
}
