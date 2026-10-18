/**
 * Process identity by command line for the dedicated Chrome.
 *
 * A process is "the dedicated Chrome" only when its command line carries BOTH
 * `--remote-debugging-pipe` and `--user-data-dir=<dedicated dir>` — never a bare
 * pid (pids are reused; `processStartedAt` is `null` on win32). Helper
 * processes (`--type=renderer|gpu-process|…`) are never the browser process.
 * A "foreign" Chrome is a browser process on the same directory WITHOUT the pipe
 * flag (the user, or an agent, started it).
 *
 * Listing: POSIX `ps -axww -o pid=,args=`; win32 `Win32_Process.CommandLine`
 * via PowerShell. Parsers and matchers are pure and exported for tests.
 *
 * See change: add-dedicated-agent-browser (D2).
 */
import { execFileAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";

export interface ProcessInfo {
  pid: number;
  /** Full command line as the OS reports it. */
  args: string;
}

/** Parse `ps -axww -o pid=,args=` output. */
export function parsePsOutput(out: string): ProcessInfo[] {
  const rows: ProcessInfo[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.*\S)\s*$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), args: m[2] });
  }
  return rows;
}

/** Parse PowerShell `ConvertTo-Json` of `ProcessId, CommandLine` (array or single object). */
export function parseWin32Processes(out: string): ProcessInfo[] {
  const text = out.replace(/^\uFEFF/, "").trim();
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const rows: ProcessInfo[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const { ProcessId, CommandLine } = it as { ProcessId?: unknown; CommandLine?: unknown };
    if (typeof ProcessId === "number" && typeof CommandLine === "string" && CommandLine.length > 0) {
      rows.push({ pid: ProcessId, args: CommandLine });
    }
  }
  return rows;
}

const WIN32_LIST_SCRIPT =
  "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--user-data-dir=*' } | " +
  "Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";

/**
 * Real process listing. Never throws: an unreadable listing yields `[]` (the
 * launch then relies on Chrome's own process singleton → early exit →
 * `launch-failed`).
 */
export async function listProcesses(platform: NodeJS.Platform = process.platform): Promise<ProcessInfo[]> {
  try {
    if (platform === "win32") {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", WIN32_LIST_SCRIPT],
        { maxBuffer: 32 * 1024 * 1024, timeout: 20_000 },
      );
      return parseWin32Processes(String(stdout));
    }
    const { stdout } = await execFileAsync("ps", ["-axww", "-o", "pid=,args="], {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 10_000,
    });
    return parsePsOutput(String(stdout));
  } catch {
    return [];
  }
}

const USER_DATA_FLAG = "--user-data-dir=";

function normalizePath(p: string, platform: NodeJS.Platform): string {
  const slashed = p.replace(/\\/g, "/");
  return platform === "win32" ? slashed.toLowerCase() : slashed;
}

/** True when the command line names exactly `dir` as its `--user-data-dir` (quotes tolerated). */
export function hasUserDataDir(args: string, dir: string, platform: NodeJS.Platform = process.platform): boolean {
  const want = normalizePath(dir, platform).replace(/\/+$/, "");
  let from = 0;
  for (;;) {
    const at = args.indexOf(USER_DATA_FLAG, from);
    if (at < 0) return false;
    from = at + USER_DATA_FLAG.length;
    if (at > 0 && !/\s/.test(args[at - 1])) continue; // not at a token start
    let rest = args.slice(from);
    if (rest[0] === '"' || rest[0] === "'") rest = rest.slice(1);
    rest = normalizePath(rest, platform);
    if (!rest.startsWith(want)) continue;
    // `agent-chrome` must not match `agent-chrome-downloads`.
    if (/^\/*(?=$|["'\s])/.test(rest.slice(want.length))) return true;
  }
}

/** True when the command line carries the `--remote-debugging-pipe` switch. */
export function hasPipeFlag(args: string): boolean {
  return /(?:^|\s)--remote-debugging-pipe(?:=\S*)?(?=\s|$)/.test(args);
}

/** Browser (main) process only: renderer/GPU/utility helpers carry `--type=`. */
export function isBrowserProcess(args: string): boolean {
  return !/(?:^|\s)--type=/.test(args);
}

export interface ClassifiedProcesses {
  /** Dedicated Chrome: pipe flag + dedicated dir. */
  dedicated: ProcessInfo[];
  /** Chrome on the dedicated dir WITHOUT the pipe flag. */
  foreign: ProcessInfo[];
}

export function classifyProcesses(
  list: readonly ProcessInfo[],
  dir: string,
  platform: NodeJS.Platform = process.platform,
): ClassifiedProcesses {
  const dedicated: ProcessInfo[] = [];
  const foreign: ProcessInfo[] = [];
  for (const p of list) {
    if (!isBrowserProcess(p.args) || !hasUserDataDir(p.args, dir, platform)) continue;
    (hasPipeFlag(p.args) ? dedicated : foreign).push(p);
  }
  return { dedicated, foreign };
}
