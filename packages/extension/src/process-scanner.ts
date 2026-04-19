/**
 * Process scanner for detecting child processes of a pi session.
 * Supports Unix (macOS + Linux) via ps/PGID and Windows via wmic/tasklist.
 *
 * Two-phase approach (Unix):
 * 1. CAPTURE: During active bash tool calls, `ps -eo pid=,ppid=` finds children
 *    of the pi process (pgrep is not used — it misses detached children on macOS).
 *    Grandchildren are found by recursing one level. PGIDs are stored in a tracked set.
 * 2. CHECK: On every scan, verify which tracked PGIDs are still alive via ps.
 *    Dead ones are removed from the set.
 *
 * This handles the reparenting problem: children get reparented to PID 1
 * when the bash wrapper exits, but we captured their PGIDs while alive.
 */
import { spawnSync as defaultSpawnSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import type { SpawnSyncReturns } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";

/**
 * Resolve a Windows system tool name (wmic / powershell / tasklist /
 * taskkill) to its full `.exe` path via the global tool registry. If
 * the registry lookup fails we fall back to the bare name and let
 * `spawnSync` do PATHEXT resolution.
 *
 * Spawning the FULL path bypasses any cmd.exe / PATHEXT resolution
 * layers, keeping `windowsHide: true` honored end-to-end. See change:
 * consolidate-windows-spawn-and-platform-handlers.
 *
 * Uses `getDefaultRegistry` (not `peek*`) because the bridge extension
 * runs inside pi's process and may be the FIRST caller to construct
 * the registry in that process. Idempotent and cached per-process.
 */
const systemToolCache = new Map<string, string>();
function resolveSystemTool(name: string): string {
  const cached = systemToolCache.get(name);
  if (cached) return cached;
  try {
    const reg = getDefaultRegistry();
    if (reg.has(name)) {
      const res = reg.resolve(name);
      if (res.ok && res.path) {
        systemToolCache.set(name, res.path);
        return res.path;
      }
    }
  } catch { /* registry unavailable in some test contexts */ }
  // Cache the bare name so we only miss once per process.
  systemToolCache.set(name, name);
  return name;
}

export interface ChildProcessInfo {
  pid: number;
  pgid: number;
  command: string;
  elapsedMs: number;
}

/**
 * Parse ps ETIME format into milliseconds.
 * Re-exported from the shared platform primitive to keep the public API of
 * this module stable while centralizing the pure helper.
 * See change: consolidate-platform-handlers.
 */
export { parseEtime } from "@blackbelt-technology/pi-dashboard-shared/platform/process-scan.js";
import { parseEtime } from "@blackbelt-technology/pi-dashboard-shared/platform/process-scan.js";

const DEFAULT_MIN_ELAPSED_MS = 30_000;

export type SpawnSyncFn = (cmd: string, args: string[], opts: any) => SpawnSyncReturns<string>;

/** Get direct child PIDs of a parent using ps (pgrep misses detached children on macOS). */
function getChildPids(parentPid: number, spawnSync: SpawnSyncFn): number[] {
  try {
    const result = spawnSync("ps", ["-eo", "pid=,ppid="], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (result.status !== 0 || !result.stdout) return [];
    const pids: number[] = [];
    for (const line of result.stdout.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length === 2) {
        const pid = parseInt(parts[0], 10);
        const ppid = parseInt(parts[1], 10);
        if (ppid === parentPid && !isNaN(pid)) pids.push(pid);
      }
    }
    return pids;
  } catch {
    return [];
  }
}

/** Parse one line of ps output: "  PID  PGID ETIME ARGS..." */
function parsePsLine(line: string): ChildProcessInfo | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
  if (!match) return null;

  return {
    pid: parseInt(match[1], 10),
    pgid: parseInt(match[2], 10),
    elapsedMs: parseEtime(match[3]),
    command: match[4],
  };
}

export interface ScanOptions {
  _spawnSync?: SpawnSyncFn;
}

/**
 * Captures new child PIDs of the pi process and adds their PGIDs to the tracked set.
 * Call this during active bash tool calls when children are still in the process tree.
 */
export function captureChildPgids(
  parentPid: number,
  trackedPgids: Set<number>,
  options?: ScanOptions,
): void {
  if ((options as any)?._platform === "win32" || (!((options as any)?._platform) && process.platform === "win32")) return;

  const spawnSync: SpawnSyncFn = options?._spawnSync ?? defaultSpawnSync;

  const directChildren = getChildPids(parentPid, spawnSync);
  if (directChildren.length === 0) return;

  // Collect all PIDs (children + grandchildren)
  const allPids: number[] = [];
  for (const childPid of directChildren) {
    const grandchildren = getChildPids(childPid, spawnSync);
    if (grandchildren.length > 0) {
      allPids.push(...grandchildren);
    } else {
      allPids.push(childPid);
    }
  }

  if (allPids.length === 0) return;

  // Get PGIDs for all discovered PIDs
  try {
    const result = spawnSync("ps", ["-p", allPids.join(","), "-o", "pgid="], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (result.status !== 0 || !result.stdout) return;

    for (const line of result.stdout.split("\n")) {
      const pgid = parseInt(line.trim(), 10);
      if (!isNaN(pgid) && pgid > 0) {
        trackedPgids.add(pgid);
      }
    }
  } catch {
    // ignore
  }
}

/**
 * Scans tracked PGIDs to find which are still alive.
 * Returns live processes, removes dead PGIDs from the set.
 */
export function scanTrackedProcesses(
  trackedPgids: Set<number>,
  minElapsedMs: number = DEFAULT_MIN_ELAPSED_MS,
  options?: ScanOptions,
): ChildProcessInfo[] {
  const platform = (options as any)?._platform ?? process.platform;
  if (platform === "win32" || trackedPgids.size === 0) return [];

  const spawnSync: SpawnSyncFn = options?._spawnSync ?? defaultSpawnSync;

  // Find all processes belonging to tracked PGIDs
  // Use ps to find processes by PGID — we check all at once
  const pgidList = Array.from(trackedPgids);

  try {
    // Get all processes, then filter by PGID
    const result = spawnSync("ps", ["-eo", "pid=,pgid=,etime=,args="], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (result.status !== 0 || !result.stdout) return [];

    const pgidSet = new Set(pgidList);
    const alivePgids = new Set<number>();
    const processes: ChildProcessInfo[] = [];

    for (const line of result.stdout.split("\n")) {
      const info = parsePsLine(line);
      if (!info) continue;
      if (!pgidSet.has(info.pgid)) continue;

      alivePgids.add(info.pgid);

      // Skip bash/sh wrappers (show the actual commands, not the shell)
      const binary = info.command.split(/\s/)[0]?.split("/").pop() ?? "";
      if (binary === "bash" || binary === "sh") continue;

      if (info.elapsedMs >= minElapsedMs) {
        processes.push(info);
      }
    }

    // Remove dead PGIDs from tracked set
    for (const pgid of pgidList) {
      if (!alivePgids.has(pgid)) {
        trackedPgids.delete(pgid);
      }
    }

    return processes;
  } catch {
    return [];
  }
}

/**
 * Combined scan: capture new children + check tracked PGIDs.
 * Convenience wrapper for the bridge timer.
 */
export function scanChildProcesses(
  parentPid: number,
  trackedPgids: Set<number>,
  minElapsedMs: number = DEFAULT_MIN_ELAPSED_MS,
  options?: ScanOptions,
): ChildProcessInfo[] {
  const platform = (options as any)?._platform ?? process.platform;
  if (platform === "win32") {
    return scanWindowsProcesses(parentPid, minElapsedMs, options);
  }

  // Phase 1: Capture any new children (during active bash calls)
  captureChildPgids(parentPid, trackedPgids, options);

  // Phase 2: Check which tracked PGIDs are still alive
  return scanTrackedProcesses(trackedPgids, minElapsedMs, options);
}

/**
 * Kill a process group by PGID using SIGTERM (Unix) or taskkill (Windows).
 * Returns true if signal was sent, false if process was already dead.
 */
export function killProcessByPgid(pgid: number, options?: ScanOptions): boolean {
  const platform = (options as any)?._platform ?? process.platform;
  if (platform === "win32") {
    return killWindowsProcess(pgid, options);
  }
  try {
    process.kill(-pgid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

// ---- Windows support ----

/** Parse wmic output lines into child process info. */
function parseWmicLine(line: string): { pid: number; ppid: number; command: string; creationDate: string } | null {
  // wmic outputs: CommandLine  CreationDate             ParentProcessId  ProcessId
  // with fixed-width columns separated by whitespace
  const parts = line.trim().split(/\s{2,}/);
  if (parts.length < 4) return null;
  const pid = parseInt(parts[3], 10);
  const ppid = parseInt(parts[2], 10);
  if (isNaN(pid) || isNaN(ppid)) return null;
  return { pid, ppid, command: parts[0] || "", creationDate: parts[1] || "" };
}

/** Convert wmic CreationDate (yyyyMMddHHmmss.ffffff+ZZZ) to elapsed ms. */
function wmicDateToElapsedMs(creationDate: string): number {
  if (!creationDate) return 0;
  // Format: 20260410225300.123456+060
  const match = creationDate.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!match) return 0;
  const created = new Date(
    parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]),
    parseInt(match[4]), parseInt(match[5]), parseInt(match[6])
  );
  return Math.max(0, Date.now() - created.getTime());
}

/** Find all descendant PIDs of a parent on Windows. */
function getWindowsDescendants(parentPid: number, spawnSync: SpawnSyncFn): ChildProcessInfo[] {
  try {
    const result = spawnSync(
      resolveSystemTool("wmic"),
      ["process", "where", `ParentProcessId=${parentPid}`, "get", "CommandLine,CreationDate,ParentProcessId,ProcessId", "/format:list"],
      {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
        // Critical: without this, every 10-second process scan flashes a
        // console window. wmic is deprecated on Win 11 but still the
        // default here; PowerShell fallback also needs windowsHide.
        // Also: `resolveSystemTool` above returns the FULL .exe path
        // when the registry is available, so there's no PATHEXT /
        // cmd.exe resolution layer that could leak a console.
        windowsHide: true,
      },
    );
    if (result.status !== 0 || !result.stdout) {
      // wmic removed in newer Windows 11 — fallback to tasklist
      return getWindowsDescendantsTasklist(parentPid, spawnSync);
    }

    const processes: ChildProcessInfo[] = [];
    let current: Partial<{ pid: number; command: string; elapsed: number }> = {};

    for (const line of result.stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (current.pid) {
          processes.push({
            pid: current.pid,
            pgid: current.pid, // Windows has no PGID; use PID
            command: current.command || "",
            elapsedMs: current.elapsed || 0,
          });
        }
        current = {};
        continue;
      }
      const [key, ...valueParts] = trimmed.split("=");
      const value = valueParts.join("=");
      if (key === "ProcessId") current.pid = parseInt(value, 10);
      if (key === "CommandLine") current.command = value;
      if (key === "CreationDate") current.elapsed = wmicDateToElapsedMs(value);
    }
    // Flush last entry
    if (current.pid) {
      processes.push({
        pid: current.pid,
        pgid: current.pid,
        command: current.command || "",
        elapsedMs: current.elapsed || 0,
      });
    }

    return processes;
  } catch {
    return [];
  }
}

/** Fallback: use tasklist when wmic is unavailable. */
function getWindowsDescendantsTasklist(parentPid: number, spawnSync: SpawnSyncFn): ChildProcessInfo[] {
  try {
    // tasklist /FI filters by parent — but tasklist doesn't support ParentProcessId filter
    // Use PowerShell Get-CimInstance as fallback
    const result = spawnSync(
      resolveSystemTool("powershell"),
      ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "ParentProcessId=${parentPid}" | Select-Object ProcessId,CommandLine,CreationDate | ConvertTo-Json`],
      {
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
        // Suppress console flash for the PowerShell fallback path.
        // `resolveSystemTool` returns the full .exe path when registry
        // is available.
        windowsHide: true,
      },
    );
    if (result.status !== 0 || !result.stdout) return [];

    const data = JSON.parse(result.stdout);
    const items = Array.isArray(data) ? data : [data];
    return items
      .filter((item: any) => item?.ProcessId)
      .map((item: any) => ({
        pid: item.ProcessId,
        pgid: item.ProcessId,
        command: item.CommandLine || "",
        elapsedMs: item.CreationDate ? Math.max(0, Date.now() - new Date(item.CreationDate).getTime()) : 0,
      }));
  } catch {
    return [];
  }
}

/** Scan child processes on Windows using wmic/PowerShell. */
export function scanWindowsProcesses(
  parentPid: number,
  minElapsedMs: number = DEFAULT_MIN_ELAPSED_MS,
  options?: ScanOptions,
): ChildProcessInfo[] {
  const spawnSync: SpawnSyncFn = options?._spawnSync ?? defaultSpawnSync;
  const children = getWindowsDescendants(parentPid, spawnSync);

  // Recurse one level for grandchildren
  const all: ChildProcessInfo[] = [];
  for (const child of children) {
    const grandchildren = getWindowsDescendants(child.pid, spawnSync);
    if (grandchildren.length > 0) {
      all.push(...grandchildren);
    } else {
      all.push(child);
    }
  }

  return all.filter(p => p.elapsedMs >= minElapsedMs);
}

/** Kill a process tree on Windows using taskkill. */
export function killWindowsProcess(pid: number, options?: ScanOptions): boolean {
  const spawnSync: SpawnSyncFn = options?._spawnSync ?? defaultSpawnSync;
  try {
    const result = spawnSync(resolveSystemTool("taskkill"), ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}
