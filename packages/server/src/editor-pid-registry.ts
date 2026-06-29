/**
 * Editor PID registry — boot-time orphan reconciliation for code-server.
 *
 * Two responsibilities, in order:
 *
 *   1. `adoptOrphans()` — consult `editor-keeper.keeperManager.discoverExistingKeepers()`
 *      and register live keepers in `editor-manager` so the dashboard
 *      reattaches without spawning. Keepers own their per-editor sidecars
 *      under `~/.pi/dashboard/editors/<editorId>.sock.pid` (POSIX) or
 *      `pi-editor-<editorId>.pid` (Windows).
 *
 *   2. `cleanupOrphans()` — defensive cmdline sweep for pre-keeper installs
 *      being upgraded: SIGTERM/SIGKILL any `code-server` process whose
 *      `--user-data-dir` matches `~/.pi/dashboard/editors/` but for which
 *      no sidecar exists. Runs AFTER adoption.
 *
 * See: openspec/changes/add-editor-keeper-sidecar (specs/editor-manager/spec.md)
 */
import os from "node:os";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process"; // ban:child_process-ok editor orphan sweep uses `ps` (POSIX) + PowerShell Get-CimInstance (Windows) probes
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { isUnsafeTestHomeScan } from "./test-env-guard.js";
import {
	isProcessAlive as platformIsProcessAlive,
	killPidWithGroup,
} from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import type { EditorManager } from "./editor-manager.js";
import type { EditorKeeperManager } from "./editor-keeper/keeper-manager.js";

/** Grace period between SIGTERM and SIGKILL escalation. */
const SIGKILL_GRACE_MS = 1000;

/** Marker that uniquely identifies a dashboard-spawned code-server cmdline. */
const DASHBOARD_DATA_DIR_MARKER = path.join(os.homedir(), ".pi", "dashboard", "editors") + path.sep;

const EDITORS_DIR = path.join(os.homedir(), ".pi", "dashboard", "editors");

export interface EditorPidRegistry {
  /** Number of in-memory tracked entries (testing aid; always 0 in keeper mode). */
  size(): number;
  /** Adopt surviving editor keepers; register them in `editor-manager`. */
  adoptOrphans(): Promise<AdoptionSummary>;
  /** Defensive sweep of pre-keeper code-server processes lacking a sidecar. */
  cleanupOrphans(): Promise<void>;
}

export interface AdoptionSummary {
  adopted: Array<{ editorId: string; cwd: string; port: number }>;
}

export interface EditorPidRegistryOptions {
  /** Required for adoption to register editors. */
  editorManager?: EditorManager;
  /** Required for adoption. Defaults to a fresh `createEditorKeeperManager()`. */
  keeperManager?: EditorKeeperManager;
  /** Override cmdline lookup (testing). */
  getCmdline?: (pid: number) => string | null;
  /** Override process-alive check (testing). */
  isProcessAlive?: (pid: number) => boolean;
  /** Override kill (testing). Returns true if signal was delivered. */
  kill?: (pid: number, signal: NodeJS.Signals) => boolean;
  /** Override grace ms between SIGTERM and SIGKILL (testing). */
  graceMs?: number;
  /** List of editorIds known to have valid sidecars (testing). */
  sidecarEditorIds?: () => Set<string>;
}

/** Minimal spawnSync surface used by the Windows cmdline probe (argv form). */
export type CmdlineSpawnSyncFn = (
  command: string,
  args: readonly string[],
  opts: { encoding: "utf-8"; windowsHide: boolean; stdio: readonly ["ignore", "pipe", "ignore"]; timeout: number },
) => { status: number | null; stdout: string | null };

/** Node spawnSync narrowed to the cmdline-probe surface (encoding pins stdout to string). */
const defaultCmdlineSpawnSync: CmdlineSpawnSyncFn = (command, args, opts) =>
  spawnSync(command, [...args], { ...opts, stdio: [...opts.stdio] });

/**
 * Default cross-platform process command-line lookup.
 * Windows uses PowerShell Get-CimInstance via spawnSync (no shell) instead of
 * wmic — wmic is removed by default on Win 11 22H2+, which made this silently
 * return null. `spawnSyncFn` is injectable for unit tests.
 */
export function defaultGetCmdline(pid: number, spawnSyncFn: CmdlineSpawnSyncFn = defaultCmdlineSpawnSync): string | null {
  try {
    if (process.platform === "linux") {
      const file = `/proc/${pid}/cmdline`;
      if (!existsSync(file)) return null;
      return readFileSync(file, "utf-8").replace(/\0/g, " ").trim();
    }
    if (process.platform === "darwin") {
      const out = execSync(`ps -p ${pid} -o command=`, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
      return out.trim() || null;
    }
    if (process.platform === "win32") {
      const script = `(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue).CommandLine`;
      const r = spawnSyncFn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { encoding: "utf-8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
      );
      if (!r || r.status !== 0) return null;
      const cmdline = (r.stdout ?? "").trim();
      return cmdline || null;
    }
  } catch { return null; }
  return null;
}

function defaultIsProcessAlive(pid: number): boolean {
  return platformIsProcessAlive(pid);
}

function defaultKill(pid: number, signal: NodeJS.Signals): boolean {
  try { killPidWithGroup(pid, signal); return true; } catch { return false; }
}

/** Verify that `cmdline` looks like a dashboard-spawned code-server. */
export function isDashboardOwnedCodeServer(cmdline: string | null): boolean {
  if (!cmdline) return false;
  return cmdline.includes("--user-data-dir") && cmdline.includes(DASHBOARD_DATA_DIR_MARKER);
}

function defaultSidecarEditorIds(): Set<string> {
  const out = new Set<string>();
  if (!existsSync(EDITORS_DIR)) return out;
  let names: string[];
  try { names = readdirSync(EDITORS_DIR); } catch { return out; }
  const isWin = process.platform === "win32";
  for (const n of names) {
    const m = isWin ? n.match(/^pi-editor-([0-9a-f]{12})\.pid$/) : n.match(/^([0-9a-f]{12})\.sock\.pid$/);
    if (m) out.add(m[1]);
  }
  return out;
}

export function createEditorPidRegistry(options: EditorPidRegistryOptions = {}): EditorPidRegistry {
  const editorManager = options.editorManager;
  const keeperManagerOpt = options.keeperManager;
  const getCmdline = options.getCmdline ?? defaultGetCmdline;
  const isAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const kill = options.kill ?? defaultKill;
  const graceMs = options.graceMs ?? SIGKILL_GRACE_MS;
  const sidecarIds = options.sidecarEditorIds ?? defaultSidecarEditorIds;

  return {
    size() { return 0; },

    async adoptOrphans(): Promise<AdoptionSummary> {
      if (isUnsafeTestHomeScan()) return { adopted: [] };
      if (!editorManager) return { adopted: [] };

      // Lazy import so `editor-pid-registry` doesn't pull in keeper-manager
      // in tests that only exercise `cleanupOrphans` legacy paths.
      let keeperManager = keeperManagerOpt;
      if (!keeperManager) {
        const mod = await import("./editor-keeper/keeper-manager.js");
        keeperManager = mod.createEditorKeeperManager();
      }

      const adoptedRaw = await keeperManager.discoverExistingKeepers();
      const adopted: AdoptionSummary["adopted"] = [];
      for (const a of adoptedRaw) {
        const info = editorManager.adopt({
          editorId: a.editorId,
          cwd: a.cwd,
          port: a.port,
        });
        adopted.push({ editorId: info.id, cwd: info.cwd, port: info.port });
      }
      return { adopted };
    },

    async cleanupOrphans() {
      if (isUnsafeTestHomeScan()) {
        console.warn("[editor-pid-registry] cleanupOrphans() blocked: running under vitest with real HOME");
        return;
      }

      // Defensive sweep: scan running processes for dashboard-marker code-server
      // that has no live sidecar. Pre-keeper installs being upgraded land here.
      const known = sidecarIds();
      const candidates = listDashboardCodeServerProcesses(getCmdline);
      // Exclude any whose cmdline references a known sidecar editorId (12-hex).
      const toKill = candidates.filter((c) => !hasKnownEditorId(c.cmdline, known));

      if (toKill.length === 0) return;

      for (const c of toKill) kill(c.pid, "SIGTERM");
      await new Promise((r) => setTimeout(r, graceMs));
      let killed = 0;
      for (const c of toKill) {
        if (isAlive(c.pid)) kill(c.pid, "SIGKILL");
        killed++;
      }
      console.log(`[editor-pid-registry] swept ${killed} pre-keeper orphan${killed === 1 ? "" : "s"}`);
    },
  };
}

function hasKnownEditorId(cmdline: string, known: Set<string>): boolean {
  // Look for a 12-hex token in the cmdline (the dataDir / editorId).
  const match = cmdline.match(/[0-9a-f]{12}/g);
  if (!match) return false;
  for (const id of match) if (known.has(id)) return true;
  return false;
}

function listDashboardCodeServerProcesses(
  getCmdline: (pid: number) => string | null,
): Array<{ pid: number; cmdline: string }> {
  // Best-effort, platform-specific PID enumeration. Mirrors the existing
  // cleanup approach (cmdline scan via `/proc` / `ps` / PowerShell Get-CimInstance).
  const out: Array<{ pid: number; cmdline: string }> = [];
  try {
    if (process.platform === "linux") {
      const procs = readdirSync("/proc").filter((n) => /^\d+$/.test(n));
      for (const n of procs) {
        const pid = Number.parseInt(n, 10);
        const cmd = getCmdline(pid);
        if (cmd && isDashboardOwnedCodeServer(cmd)) out.push({ pid, cmdline: cmd });
      }
      return out;
    }
    if (process.platform === "darwin") {
      const raw = execSync("ps -axo pid=,command=", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
      for (const line of raw.split("\n")) {
        const m = line.trim().match(/^(\d+)\s+(.+)$/);
        if (!m) continue;
        if (!isDashboardOwnedCodeServer(m[2])) continue;
        out.push({ pid: Number.parseInt(m[1], 10), cmdline: m[2] });
      }
      return out;
    }
    if (process.platform === "win32") {
      // PowerShell Get-CimInstance (no wmic). Emit `pid<TAB>commandline`
      // per process; tab-split avoids CSV-quoting headaches. spawnSync,
      // no shell, windowsHide — no console flash, no parent-stderr leak.
      const script =
        "Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue | " +
        'ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }';
      const r = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { encoding: "utf-8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"], timeout: 8000 },
      );
      const raw = r.status === 0 ? (r.stdout ?? "") : "";
      for (const line of raw.split("\n")) {
        const idx = line.indexOf("\t");
        if (idx < 0) continue;
        const pid = Number.parseInt(line.slice(0, idx).trim(), 10);
        const cmd = line.slice(idx + 1).trim();
        if (!Number.isFinite(pid) || !cmd) continue;
        if (!isDashboardOwnedCodeServer(cmd)) continue;
        out.push({ pid, cmdline: cmd });
      }
      return out;
    }
  } catch { /* fall through */ }
  return out;
}
