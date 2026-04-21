/**
 * Persistent registry of spawned `code-server` editor instances.
 *
 * Persists PIDs to ~/.pi/dashboard/editor-pids.json so that, after a non-graceful
 * dashboard shutdown (SIGKILL, crash, OOM, force-quit), the next server boot can
 * sweep and SIGTERM/SIGKILL orphan code-server processes that were reparented to
 * init/launchd.
 *
 * Mirrors the persistence + boot-sweep pattern of `headless-pid-registry.ts` but
 * KILLS live orphans (not reclaim) — editor instances are dashboard-internal,
 * unreachable after restart, and the user expects a clean state.
 */
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process"; // ban:child_process-ok editor orphan sweep uses `ps`/`taskkill` probe for bounded wait; tracked tech debt for migration to platform/process Recipe
import { readFileSync, existsSync } from "node:fs";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { isUnsafeTestHomeScan } from "./test-env-guard.js";
import {
	isProcessAlive as platformIsProcessAlive,
	killPidWithGroup,
} from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";

const DEFAULT_PID_FILE = path.join(os.homedir(), ".pi", "dashboard", "editor-pids.json");

/** Grace period between SIGTERM and SIGKILL escalation. */
const SIGKILL_GRACE_MS = 1000;

/** Marker that uniquely identifies a dashboard-spawned code-server cmdline. */
const DASHBOARD_DATA_DIR_MARKER = path.join(os.homedir(), ".pi", "dashboard", "editors") + path.sep;

export interface PersistedEditorEntry {
  id: string;
  pid: number;
  port: number;
  cwd: string;
  dataDir: string;
  /** ISO 8601 timestamp */
  spawnedAt: string;
}

interface EditorPidFileData {
  entries: PersistedEditorEntry[];
}

export interface EditorPidRegistry {
  /** Record a newly-ready editor instance. */
  register(entry: Omit<PersistedEditorEntry, "spawnedAt"> & { spawnedAt?: number | string }): void;
  /** Remove an entry by editor id. */
  remove(id: string): void;
  /** Number of in-memory tracked entries (testing aid). */
  size(): number;
  /** Sweep persisted entries on server boot, killing verified orphans. */
  cleanupOrphans(): Promise<void>;
}

export interface EditorPidRegistryOptions {
  pidFilePath?: string;
  /** Override cmdline lookup (testing). */
  getCmdline?: (pid: number) => string | null;
  /** Override process-alive check (testing). */
  isProcessAlive?: (pid: number) => boolean;
  /** Override kill (testing). Returns true if signal was delivered. */
  kill?: (pid: number, signal: NodeJS.Signals) => boolean;
  /** Override grace ms between SIGTERM and SIGKILL (testing). */
  graceMs?: number;
}

/** Default cross-platform process command-line lookup. */
function defaultGetCmdline(pid: number): string | null {
  try {
    if (process.platform === "linux") {
      const file = `/proc/${pid}/cmdline`;
      if (!existsSync(file)) return null;
      // /proc cmdline is NUL-separated
      return readFileSync(file, "utf-8").replace(/\0/g, " ").trim();
    }
    if (process.platform === "darwin") {
      const out = execSync(`ps -p ${pid} -o command=`, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
      return out.trim() || null;
    }
    if (process.platform === "win32") {
      const out = execSync(`wmic process where ProcessId=${pid} get CommandLine /value`, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
      const m = out.match(/CommandLine=(.*)/);
      return m ? m[1].trim() : null;
    }
  } catch {
    return null;
  }
  return null;
}

/** Route through platform/process.ts so lint enforcement and cross-platform
 * semantics (libuv signal 0 check, POSIX group kill) stay in one place. */
function defaultIsProcessAlive(pid: number): boolean {
  return platformIsProcessAlive(pid);
}

function defaultKill(pid: number, signal: NodeJS.Signals): boolean {
  try {
    killPidWithGroup(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/** Verify that `cmdline` looks like a dashboard-spawned code-server. */
export function isDashboardOwnedCodeServer(cmdline: string | null): boolean {
  if (!cmdline) return false;
  // Must reference --user-data-dir under ~/.pi/dashboard/editors/
  return cmdline.includes("--user-data-dir") && cmdline.includes(DASHBOARD_DATA_DIR_MARKER);
}

export function createEditorPidRegistry(options: EditorPidRegistryOptions = {}): EditorPidRegistry {
  const pidFilePath = options.pidFilePath ?? DEFAULT_PID_FILE;
  const getCmdline = options.getCmdline ?? defaultGetCmdline;
  const isAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const kill = options.kill ?? defaultKill;
  const graceMs = options.graceMs ?? SIGKILL_GRACE_MS;

  // In-memory mirror of the file (id → entry).
  const entries = new Map<string, PersistedEditorEntry>();

  function persist(): void {
    try {
      const data: EditorPidFileData = { entries: [...entries.values()] };
      writeJsonFile(pidFilePath, data);
    } catch {
      // Best-effort: persistence failures must not break editor lifecycle.
    }
  }

  return {
    register(entry) {
      const spawnedAt =
        typeof entry.spawnedAt === "string"
          ? entry.spawnedAt
          : new Date(entry.spawnedAt ?? Date.now()).toISOString();
      entries.set(entry.id, {
        id: entry.id,
        pid: entry.pid,
        port: entry.port,
        cwd: entry.cwd,
        dataDir: entry.dataDir,
        spawnedAt,
      });
      persist();
    },

    remove(id) {
      if (entries.delete(id)) persist();
    },

    size() {
      return entries.size;
    },

    async cleanupOrphans() {
      if (isUnsafeTestHomeScan()) {
        console.warn("[editor-pid-registry] cleanupOrphans() blocked: running under vitest with real HOME");
        return;
      }
      const data = readJsonFile<EditorPidFileData>(pidFilePath, { entries: [] });
      const persisted = Array.isArray(data?.entries) ? data.entries : [];

      let killed = 0;
      const toKill: PersistedEditorEntry[] = [];

      for (const entry of persisted) {
        if (!isAlive(entry.pid)) continue;
        const cmdline = getCmdline(entry.pid);
        if (!isDashboardOwnedCodeServer(cmdline)) continue;
        toKill.push(entry);
      }

      for (const entry of toKill) {
        kill(entry.pid, "SIGTERM");
      }

      if (toKill.length > 0) {
        await new Promise((r) => setTimeout(r, graceMs));
        for (const entry of toKill) {
          if (isAlive(entry.pid)) {
            kill(entry.pid, "SIGKILL");
          }
          killed++;
        }
      }

      // Reset to whatever the new server has registered so far (initially nothing).
      persist();

      if (killed > 0) {
        console.log(`[editor-pid-registry] cleaned ${killed} orphan${killed === 1 ? "" : "s"}`);
      }
    },
  };
}
