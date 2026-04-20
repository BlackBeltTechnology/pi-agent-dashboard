/**
 * Server-side lifecycle manager for code-server child processes.
 * Spawns per-folder instances, tracks heartbeats, enforces idle timeout and max instances.
 */
import { spawn, type ChildProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { killPidWithGroup, killProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { createServer as createNetServer, Socket as NetSocket } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { EditorInstanceStatus, EditorDetectionResult } from "@blackbelt-technology/pi-dashboard-shared/editor-types.js";
import type { EditorConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { detectCodeServerBinary, resetDetectionCache } from "./editor-detection.js";
import { buildSpawnEnv } from "./process-manager.js";
import type { EditorPidRegistry } from "./editor-pid-registry.js";

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
  process: ChildProcess | null;
  lastHeartbeat: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export interface EditorManagerOptions {
  config: EditorConfig;
  detection: EditorDetectionResult;
  onStatusChange?: (cwd: string, id: string, status: EditorInstanceStatus) => void;
  /** Override re-detection (for testing). When false, skip runtime re-detection. */
  allowRedetection?: boolean;
  /** Optional persistent PID registry for orphan cleanup across restarts. */
  pidRegistry?: EditorPidRegistry;
}

export interface EditorManager {
  start(cwd: string, theme?: "dark" | "light"): Promise<EditorInstanceInfo>;
  stop(id: string): void;
  heartbeat(id: string): void;
  setTheme(cwd: string, theme: "dark" | "light"): void;
  get(id: string): EditorInstanceInfo | undefined;
  getByFolder(cwd: string): EditorInstanceInfo | undefined;
  list(): EditorInstanceInfo[];
  stopAll(): void;
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

function generateId(): string {
  return "editor-" + randomBytes(6).toString("hex");
}

function folderHash(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 12);
}

const DEFAULT_DARK_THEME = "Default Dark Modern";
const DEFAULT_LIGHT_THEME = "Default Light Modern";

/**
 * Write VS Code settings.json with the correct color theme.
 * Disables autoDetectColorScheme (unreliable in iframes) and sets the theme
 * directly. VS Code's file watcher picks up changes while running.
 */
function writeVscodeThemeSettings(dataDir: string, theme: "dark" | "light" = "dark"): void {
  const userDir = path.join(dataDir, "User");
  mkdirSync(userDir, { recursive: true });

  const settingsPath = path.join(userDir, "settings.json");

  // Merge with existing settings to preserve user customizations
  let existing: Record<string, unknown> = {};
  try {
    if (existsSync(settingsPath)) {
      existing = JSON.parse(readFileSync(settingsPath, "utf-8"));
    }
  } catch { /* ignore parse errors */ }

  const darkTheme = (existing["workbench.preferredDarkColorTheme"] as string) ?? DEFAULT_DARK_THEME;
  const lightTheme = (existing["workbench.preferredLightColorTheme"] as string) ?? DEFAULT_LIGHT_THEME;

  const settings = {
    ...existing,
    // Disable auto-detect — it reads OS preference, not the dashboard's theme
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

export function createEditorManager(options: EditorManagerOptions): EditorManager {
  const { config, detection, onStatusChange, allowRedetection = true, pidRegistry } = options;
  const instances = new Map<string, InternalInstance>();
  const cwdIndex = new Map<string, string>(); // cwd → id
  const idleTimeoutMs = (config.idleTimeoutMinutes ?? 10) * 60 * 1000;
  const maxInstances = config.maxInstances ?? 3;

  function setStatus(inst: InternalInstance, status: EditorInstanceStatus) {
    inst.status = status;
    onStatusChange?.(inst.cwd, inst.id, status);
  }

  function clearIdleTimer(inst: InternalInstance) {
    if (inst.idleTimer) {
      clearTimeout(inst.idleTimer);
      inst.idleTimer = null;
    }
  }

  function startIdleTimer(inst: InternalInstance) {
    clearIdleTimer(inst);
    inst.idleTimer = setTimeout(() => {
      stop(inst.id);
    }, idleTimeoutMs);
  }

  function cleanup(id: string) {
    const inst = instances.get(id);
    if (!inst) return;
    clearIdleTimer(inst);
    cwdIndex.delete(inst.cwd);
    instances.delete(id);
  }

  function evictOldestIdle(): boolean {
    let oldest: InternalInstance | null = null;
    for (const inst of instances.values()) {
      if (inst.status !== "ready") continue;
      if (!oldest || inst.lastHeartbeat < oldest.lastHeartbeat) {
        oldest = inst;
      }
    }
    if (oldest) {
      stop(oldest.id);
      return true;
    }
    return false;
  }

  function setTheme(cwd: string, theme: "dark" | "light"): void {
    const dataDir = path.join(os.homedir(), ".pi", "dashboard", "editors", folderHash(cwd));
    writeVscodeThemeSettings(dataDir, theme);
  }

  async function start(cwd: string, theme?: "dark" | "light"): Promise<EditorInstanceInfo> {
    // Return existing instance (wait if still starting)
    const existingId = cwdIndex.get(cwd);
    if (existingId) {
      const inst = instances.get(existingId);
      if (inst) {
        // Update theme settings — VS Code's file watcher picks up changes
        if (theme) {
          setTheme(cwd, theme);
        }
        if (inst.status === "starting") {
          // Wait for it to become ready
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
        // Re-detect in case code-server was installed since last check
        resetDetectionCache();
        const fresh = detectCodeServerBinary(config);
        detection.available = fresh.available;
        detection.binary = fresh.binary;
      }
      if (!detection.available || !detection.binary) {
        throw new Error("binary_not_found");
      }
    }

    // Enforce max instances
    if (instances.size >= maxInstances) {
      if (!evictOldestIdle()) {
        throw new Error("max_instances_reached");
      }
    }

    const id = generateId();
    const port = await allocatePort();
    const dataDir = path.join(os.homedir(), ".pi", "dashboard", "editors", folderHash(cwd));

    // Write VS Code settings with theme preferences before spawning
    writeVscodeThemeSettings(dataDir, theme ?? "dark");

    const inst: InternalInstance = {
      id,
      cwd,
      port,
      status: "starting",
      process: null,
      lastHeartbeat: Date.now(),
      idleTimer: null,
    };

    instances.set(id, inst);
    cwdIndex.set(cwd, id);
    setStatus(inst, "starting");

    // Spawn code-server
    const args = [
      "--auth", "none",
      "--bind-addr", `127.0.0.1:${port}`,
      "--disable-telemetry",
      "--disable-update-check",
      "--user-data-dir", dataDir,
      cwd,
    ];

    // Use buildSpawnEnv to ensure node and user bin dirs are on PATH
    const child = spawn(detection.binary, args, {
      stdio: "ignore",
      detached: false,
      env: buildSpawnEnv(),
    });

    inst.process = child;

    child.on("error", (err) => {
      console.error(`[editor-manager] code-server error for ${cwd}:`, err.message);
      setStatus(inst, "stopped");
      pidRegistry?.remove(id);
      cleanup(id);
    });

    child.on("exit", (code) => {
      if (inst.status !== "stopped") {
        console.log(`[editor-manager] code-server exited (code=${code}) for ${cwd}`);
        setStatus(inst, "stopped");
      }
      pidRegistry?.remove(id);
      cleanup(id);
    });

    // Wait for ready
    const ready = await waitForPort(port);
    if (!ready) {
      stop(id);
      throw new Error("code-server failed to start within timeout");
    }

    setStatus(inst, "ready");
    if (pidRegistry && typeof child.pid === "number") {
      pidRegistry.register({
        id,
        pid: child.pid,
        port,
        cwd,
        dataDir,
        spawnedAt: inst.lastHeartbeat,
      });
    }
    startIdleTimer(inst);
    return toInfo(inst);
  }

  function stop(id: string) {
    const inst = instances.get(id);
    if (!inst) return;

    // Remove from persistent registry FIRST so a crash mid-stop
    // leaves the registry consistent on the next boot.
    pidRegistry?.remove(id);

    clearIdleTimer(inst);
    setStatus(inst, "stopped");

    if (inst.process && !inst.process.killed) {
      const pid = inst.process.pid;
      if (pid != null) {
        // Tree-kill the code-server subtree. On Windows this becomes
        // `taskkill /F /T /PID` (async); on POSIX it's SIGTERM → 2s → SIGKILL
        // of the process group. Fire-and-forget: `stop()` is synchronous
        // by convention and callers don't await. See change:
        // route-kill-paths-through-platform.
        void killProcess(pid, { timeoutMs: 2000 }).catch(() => {
          // Fallback to a direct pgroup SIGTERM if the platform helper
          // couldn't complete (rare; mostly for already-dead processes).
          try { killPidWithGroup(pid, "SIGTERM"); } catch { /* already dead */ }
        });
      } else {
        // No PID yet (process hasn't started). Fall back to the raw
        // ChildProcess.kill() which only signals the leaf.
        try { inst.process.kill("SIGTERM"); } catch { /* already dead */ }
      }
    }

    cleanup(id);
  }

  function heartbeat(id: string) {
    const inst = instances.get(id);
    if (!inst) return;
    inst.lastHeartbeat = Date.now();
    if (inst.status === "ready") {
      startIdleTimer(inst);
    }
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

  function stopAll() {
    for (const id of [...instances.keys()]) {
      stop(id);
    }
  }

  return { start, stop, heartbeat, setTheme, get, getByFolder, list, stopAll };
}
