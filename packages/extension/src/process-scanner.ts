/**
 * Process scanner for detecting child processes of a pi session.
 * Supports Unix (macOS + Linux) via ps/PGID and Windows via PowerShell Get-CimInstance.
 *
 * ONE snapshot per scan (Unix `ps -A`, Windows one Get-CimInstance); the child
 * tree, tracked-PGID liveness and exclusion reaping are all derived in memory
 * (`scanFromSnapshot` / `scanWindowsFromSnapshot`). Tracked PGIDs survive the
 * reparenting of children to PID 1 when their bash wrapper exits.
 * See change: optimize-polling-hot-paths.
 */
import { spawnSync as defaultSpawnSync, execFileAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import type { SpawnSyncReturns } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { incPollCost } from "./poll-cost.js";
import { killPidWithGroup } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";

/**
 * Resolve a Windows system tool name (powershell / tasklist /
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
 * Resolve pi's OWN process-group id once and cache it. pi's plugin/MCP
 * sidecars (e.g. context-mode's `server.bundle.mjs`) are spawned directly
 * by pi and inherit pi's PGID, so seeding `excludedPgids` with this value
 * keeps pi-self + same-group plumbing out of the process list.
 *
 * Unix-only: `ps -o pgid= -p <pid>`. Returns `undefined` on Windows (the
 * scan path there is PID-based, so the exclusion is a no-op) or on any
 * failure. Cached for the process lifetime. See change:
 * classify-process-list-entries.
 */
let ownPgidResolved = false;
let ownPgidValue: number | undefined;

export function getOwnPgid(options?: {
  _spawnSync?: SpawnSyncFn;
  _platform?: string;
  _pid?: number;
}): number | undefined {
  if (ownPgidResolved) return ownPgidValue;
  const platform = options?._platform ?? process.platform;
  const spawnSync = options?._spawnSync ?? defaultSpawnSync;
  const pid = options?._pid ?? process.pid;
  ownPgidValue = resolveOwnPgid(pid, platform, spawnSync);
  ownPgidResolved = true;
  return ownPgidValue;
}

function resolveOwnPgid(pid: number, platform: string, spawnSync: SpawnSyncFn): number | undefined {
  if (platform === "win32") return undefined;
  try {
    const result = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (result.status !== 0 || !result.stdout) return undefined;
    const pgid = parseInt(result.stdout.trim(), 10);
    return !isNaN(pgid) && pgid > 0 ? pgid : undefined;
  } catch {
    return undefined;
  }
}

/** Test-only: reset the cached own-PGID so each test resolves fresh. */
export function __resetOwnPgidCacheForTests(): void {
  ownPgidResolved = false;
  ownPgidValue = undefined;
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
/** Async exec seam (tests inject; prod uses shared `execFileAsync`). */
type ExecFileAsyncFn = (
  file: string,
  args: readonly string[],
  opts: any,
) => Promise<{ stdout: string | Buffer; stderr?: string | Buffer }>;

/** One row of a whole-machine process snapshot. On Windows `pgid === pid`. */
export interface ProcRow {
  pid: number;
  ppid: number;
  pgid: number;
  elapsedMs: number;
  args: string;
}

export interface ScanOptions {
  _spawnSync?: SpawnSyncFn;
  _execFile?: ExecFileAsyncFn;
  _platform?: string;
  /** Test seam for the Windows `CreationDate` → elapsed computation. */
  _now?: () => number;
  /**
   * PGIDs (PIDs on Windows) the caller has identified as its own self-spawned
   * infrastructure (dashboard server, RPC keeper); never surfaced in the
   * output nor tracked. Dead entries are reaped on each scan so the set does
   * not leak across long-lived bridges.
   * See changes: tighten-process-list-ux, optimize-polling-hot-paths.
   */
  excludedPgids?: Set<number>;
}

const UNIX_PS_ARGS = ["-A", "-o", "pid=,ppid=,pgid=,etime=,args="];
const WIN_PS_COMMAND =
  "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress";

/**
 * Parse `ps -A -o pid=,ppid=,pgid=,etime=,args=`: four leading numeric/etime
 * fields, the remainder is the command line (may contain spaces, may be empty
 * for a zombie — the row still carries its tree edge).
 */
export function parseProcessSnapshot(stdout: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)(?:\s+(.*?))?\s*$/);
    if (!m) continue;
    rows.push({
      pid: parseInt(m[1], 10),
      ppid: parseInt(m[2], 10),
      pgid: parseInt(m[3], 10),
      elapsedMs: parseEtime(m[4]),
      args: m[5] ?? "",
    });
  }
  return rows;
}

function groupByParent(rows: ProcRow[]): Map<number, ProcRow[]> {
  const byParent = new Map<number, ProcRow[]>();
  for (const r of rows) {
    const list = byParent.get(r.ppid);
    if (list) list.push(r);
    else byParent.set(r.ppid, [r]);
  }
  return byParent;
}

/** Leaf-only targets under `parentPid`: a child with children is replaced by them. */
function leafTargets(byParent: Map<number, ProcRow[]>, parentPid: number, skip?: (r: ProcRow) => boolean): ProcRow[] {
  const out: ProcRow[] = [];
  for (const child of byParent.get(parentPid) ?? []) {
    if (skip?.(child)) continue;
    const grandchildren = (byParent.get(child.pid) ?? []).filter((g) => !skip?.(g));
    if (grandchildren.length > 0) out.push(...grandchildren);
    else out.push(child);
  }
  return out;
}

/**
 * Pure Unix scan over ONE snapshot: capture the PGIDs of the pi process's
 * leaf descendants into `trackedPgids` (children reparent to PID 1 when their
 * bash wrapper exits, hence the tracked set), then list every live process of
 * a tracked PGID. Dead tracked PGIDs and dead excluded PGIDs are reaped.
 */
export function scanFromSnapshot(
  rows: ProcRow[],
  parentPid: number,
  trackedPgids: Set<number>,
  minElapsedMs: number = DEFAULT_MIN_ELAPSED_MS,
  excludedPgids?: Set<number>,
): ChildProcessInfo[] {
  // Capture
  for (const t of leafTargets(groupByParent(rows), parentPid)) {
    if (t.pgid > 0 && !excludedPgids?.has(t.pgid)) trackedPgids.add(t.pgid);
  }

  const alivePgidsAll = new Set<number>();
  const aliveTracked = new Set<number>();
  const processes: ChildProcessInfo[] = [];
  for (const r of rows) {
    alivePgidsAll.add(r.pgid);
    if (!trackedPgids.has(r.pgid)) continue;
    aliveTracked.add(r.pgid);
    // Skip bash/sh wrappers (show the actual commands, not the shell)
    const binary = r.args.split(/\s/)[0]?.split("/").pop() ?? "";
    if (binary === "bash" || binary === "sh") continue;
    if (excludedPgids?.has(r.pgid)) continue;
    if (r.elapsedMs >= minElapsedMs) {
      processes.push({ pid: r.pid, pgid: r.pgid, command: r.args, elapsedMs: r.elapsedMs });
    }
  }
  for (const pgid of [...trackedPgids]) if (!aliveTracked.has(pgid)) trackedPgids.delete(pgid);
  if (excludedPgids) {
    for (const pgid of [...excludedPgids]) if (!alivePgidsAll.has(pgid)) excludedPgids.delete(pgid);
  }
  return processes;
}

function creationMs(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const legacy = value.match(/\/Date\((-?\d+)/);
    if (legacy) return parseInt(legacy[1], 10);
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? undefined : t;
  }
  if (value && typeof value === "object") return creationMs((value as any).value ?? (value as any).DateTime);
  return undefined;
}

/** Parse the Windows CIM JSON (array, or a single object) into snapshot rows. */
function parseWindowsSnapshot(stdout: string, now: number = Date.now()): ProcRow[] {
  const data = JSON.parse(stdout);
  const items = Array.isArray(data) ? data : [data];
  const rows: ProcRow[] = [];
  for (const item of items) {
    if (!item?.ProcessId) continue;
    const created = creationMs(item.CreationDate);
    rows.push({
      pid: item.ProcessId,
      ppid: item.ParentProcessId ?? 0,
      pgid: item.ProcessId,
      elapsedMs: created === undefined ? 0 : Math.max(0, now - created),
      args: item.CommandLine || "",
    });
  }
  return rows;
}

/**
 * Pure Windows scan over one snapshot. No PGID/tracked set (PID based): leaf
 * descendants of `parentPid` minus `excludedPgids` (matched by PID, subtree
 * skipped); dead excluded PIDs are reaped. No shell-wrapper name filter.
 */
function scanWindowsFromSnapshot(
  rows: ProcRow[],
  parentPid: number,
  minElapsedMs: number = DEFAULT_MIN_ELAPSED_MS,
  excludedPgids?: Set<number>,
): ChildProcessInfo[] {
  const targets = leafTargets(groupByParent(rows), parentPid, (r) => excludedPgids?.has(r.pid) === true);
  if (excludedPgids) {
    const alive = new Set(rows.map((r) => r.pid));
    for (const pid of [...excludedPgids]) if (!alive.has(pid)) excludedPgids.delete(pid);
  }
  return targets
    .filter((r) => r.elapsedMs >= minElapsedMs)
    .map((r) => ({ pid: r.pid, pgid: r.pgid, command: r.args, elapsedMs: r.elapsedMs }));
}

interface SnapshotPlan {
  cmd: string;
  args: string[];
  timeout: number;
  parse: (stdout: string) => ProcRow[];
  scan: (rows: ProcRow[]) => ChildProcessInfo[];
}

function planFor(
  parentPid: number,
  trackedPgids: Set<number>,
  minElapsedMs: number,
  options?: ScanOptions,
): SnapshotPlan {
  const platform = options?._platform ?? process.platform;
  const excluded = options?.excludedPgids;
  if (platform === "win32") {
    const now = options?._now ?? Date.now;
    return {
      cmd: resolveSystemTool("powershell"),
      args: ["-NoProfile", "-NonInteractive", "-Command", WIN_PS_COMMAND],
      timeout: 10_000,
      parse: (out) => parseWindowsSnapshot(out, now()),
      scan: (rows) => scanWindowsFromSnapshot(rows, parentPid, minElapsedMs, excluded),
    };
  }
  return {
    cmd: "ps",
    args: UNIX_PS_ARGS,
    timeout: 5_000,
    parse: parseProcessSnapshot,
    scan: (rows) => scanFromSnapshot(rows, parentPid, trackedPgids, minElapsedMs, excluded),
  };
}

/**
 * One scan = ONE `ps -A` (Unix) / ONE Get-CimInstance (Windows) spawn. Any
 * failure returns `[]` and leaves `trackedPgids` untouched.
 */
export function scanChildProcesses(
  parentPid: number,
  trackedPgids: Set<number>,
  minElapsedMs: number = DEFAULT_MIN_ELAPSED_MS,
  options?: ScanOptions,
): ChildProcessInfo[] {
  const spawnSync: SpawnSyncFn = options?._spawnSync ?? defaultSpawnSync;
  const plan = planFor(parentPid, trackedPgids, minElapsedMs, options);
  const t0 = Date.now();
  incPollCost("pollProcScanRuns");
  incPollCost("pollProcScanSpawns");
  try {
    const result = spawnSync(plan.cmd, plan.args, {
      encoding: "utf-8",
      timeout: plan.timeout,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    if (result.status !== 0 || !result.stdout) return [];
    return plan.scan(plan.parse(result.stdout));
  } catch {
    return [];
  } finally {
    incPollCost("pollProcScanMs", Date.now() - t0);
  }
}

/** Async twin of `scanChildProcesses` (same parser/decision code). Never rejects. */
export async function scanChildProcessesAsync(
  parentPid: number,
  trackedPgids: Set<number>,
  minElapsedMs: number = DEFAULT_MIN_ELAPSED_MS,
  options?: ScanOptions,
): Promise<ChildProcessInfo[]> {
  const execFile: ExecFileAsyncFn = options?._execFile ?? execFileAsync;
  const plan = planFor(parentPid, trackedPgids, minElapsedMs, options);
  const t0 = Date.now();
  incPollCost("pollProcScanRuns");
  incPollCost("pollProcScanSpawns");
  try {
    const { stdout } = await execFile(plan.cmd, plan.args, {
      encoding: "utf8",
      timeout: plan.timeout,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
    const text = typeof stdout === "string" ? stdout : stdout.toString("utf8");
    if (!text) return [];
    return plan.scan(plan.parse(text));
  } catch {
    return [];
  } finally {
    incPollCost("pollProcScanMs", Date.now() - t0);
  }
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
    // Route through the platform helper so the pid → -pgid mapping stays
    // in one place. See change: route-kill-paths-through-platform.
    killPidWithGroup(pgid, "SIGTERM", { platform });
    return true;
  } catch {
    return false;
  }
}

// ---- Windows support ----

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
