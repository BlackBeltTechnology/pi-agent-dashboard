/**
 * Registry mapping headless child processes to session IDs.
 * Tracks PID + cwd at spawn time, links to sessionId when the bridge connects.
 * Persists entries to disk so a restarted server can clean up orphans.
 */
import type { ChildProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { EventEmitter } from "node:events";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { killPidWithGroup, isProcessAlive } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import path from "node:path";
import os from "node:os";
import { isUnsafeTestHomeScan } from "./test-env-guard.js";

/** Default PID file path */
const DEFAULT_PID_FILE = path.join(os.homedir(), ".pi", "dashboard", "headless-pids.json");

/** Max age before an orphan is killed (7 days) */
const MAX_ORPHAN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface HeadlessEntry {
  pid: number;
  cwd: string;
  process: ChildProcess;
  sessionId?: string;
  spawnedAt: number;
}

/** Serialized format for disk persistence */
interface PersistedEntry {
  pid: number;
  cwd: string;
  spawnedAt: string;
}

interface PidFileData {
  entries: PersistedEntry[];
}

export interface HeadlessPidRegistry {
  /** Register a newly spawned headless process. */
  register(pid: number, cwd: string, proc: ChildProcess): void;
  /** Link a session ID to a tracked PID by matching cwd (FIFO). */
  linkSession(sessionId: string, cwd: string): boolean;
  /** Get the PID linked to a session ID. */
  getPid(sessionId: string): number | undefined;
  /** Send SIGTERM to the process linked to a session ID. Returns true if killed. */
  killBySessionId(sessionId: string): boolean;
  /** Remove a tracked process by PID. */
  remove(pid: number): void;
  /** Kill all tracked processes (for server shutdown). */
  killAll(): void;
  /** Number of tracked entries (for testing). */
  size(): number;
  /** Clean up orphan processes from a previous server instance. */
  cleanupOrphans(): void;
}

export interface HeadlessPidRegistryOptions {
  pidFilePath?: string;
}

export function createHeadlessPidRegistry(options?: HeadlessPidRegistryOptions): HeadlessPidRegistry {
  const entries = new Map<number, HeadlessEntry>();
  const pidFilePath = options?.pidFilePath ?? DEFAULT_PID_FILE;

  function persist() {
    const data: PidFileData = {
      entries: [...entries.values()].map((e) => ({
        pid: e.pid,
        cwd: e.cwd,
        spawnedAt: new Date(e.spawnedAt).toISOString(),
      })),
    };
    try {
      writeJsonFile(pidFilePath, data);
    } catch {
      // Non-fatal — persistence is best-effort
    }
  }

  function loadFromDisk(): PersistedEntry[] {
    const data = readJsonFile<PidFileData>(pidFilePath, { entries: [] });
    return data.entries ?? [];
  }

  return {
    register(pid: number, cwd: string, proc: ChildProcess) {
      entries.set(pid, { pid, cwd, process: proc, spawnedAt: Date.now() });
      proc.on("exit", () => {
        entries.delete(pid);
        persist();
      });
      persist();
    },

    linkSession(sessionId: string, cwd: string): boolean {
      for (const entry of entries.values()) {
        if (entry.cwd === cwd && !entry.sessionId) {
          entry.sessionId = sessionId;
          return true;
        }
      }
      return false;
    },

    getPid(sessionId: string): number | undefined {
      for (const entry of entries.values()) {
        if (entry.sessionId === sessionId) {
          return entry.pid;
        }
      }
      return undefined;
    },

    killBySessionId(sessionId: string): boolean {
      for (const entry of entries.values()) {
        if (entry.sessionId === sessionId) {
          try {
            // Delegate platform-specific pid-vs-group-pid handling to the
            // shared primitive. See change: consolidate-platform-handlers.
            killPidWithGroup(entry.pid, "SIGTERM");
            entries.delete(entry.pid);
            persist();
            return true;
          } catch {
            entries.delete(entry.pid);
            persist();
            return false;
          }
        }
      }
      return false;
    },

    remove(pid: number) {
      entries.delete(pid);
      persist();
    },

    killAll() {
      if (isUnsafeTestHomeScan()) {
        console.warn("[headless-pid-registry] killAll() blocked: running under vitest with real HOME");
        return;
      }
      for (const [pid] of entries) {
        try {
          killPidWithGroup(pid, "SIGTERM");
        } catch {
          // Process may have already exited
        }
      }
      entries.clear();
      // Don't persist here — keep disk entries so cleanupOrphans() can
      // reclaim surviving processes after a server restart.
    },

    size() {
      return entries.size;
    },

    cleanupOrphans() {
      if (isUnsafeTestHomeScan()) {
        console.warn("[headless-pid-registry] cleanupOrphans() blocked: running under vitest with real HOME");
        return;
      }
      const persisted = loadFromDisk();
      const now = Date.now();

      for (const entry of persisted) {
        const spawnedAt = new Date(entry.spawnedAt).getTime();
        const age = now - spawnedAt;

        if (!isProcessAlive(entry.pid)) {
          // Dead process — skip (will be removed from file on persist)
          continue;
        }

        if (age > MAX_ORPHAN_AGE_MS) {
          // Very old orphan — kill (process group on Unix, direct on Windows)
          try {
            killPidWithGroup(entry.pid, "SIGTERM");
          } catch {
            // Already dead
          }
          continue;
        }

        // Alive and not too old — reclaim into registry
        // Create a dummy ChildProcess-like emitter for the entry
        // EventEmitter imported at top level
        const dummyProc = new EventEmitter() as ChildProcess;
        entries.set(entry.pid, {
          pid: entry.pid,
          cwd: entry.cwd,
          process: dummyProc,
          spawnedAt,
        });
      }

      persist();
    },
  };
}
