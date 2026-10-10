/**
 * Cross-platform process enumeration primitives: is-process-running,
 * ps/tasklist pattern-matching, elapsed-time parsing.
 *
 * Every OS-dependent helper accepts injectable `platform` and `exec`
 * parameters (defaulting to `process.platform` and `execSync`), so tests
 * can exercise both branches without mutating the global `process.platform`.
 * See change: consolidate-platform-handlers.
 */

import path from "node:path";
import { execFileAsync, execSync } from "./exec.js";

type ExecFn = (cmd: string, opts: { encoding: "utf-8"; stdio?: any }) => string;

export interface ProcessScanOpts {
  /** Override platform (defaults to process.platform). */
  platform?: NodeJS.Platform;
  /** Override execSync (for tests). */
  exec?: ExecFn;
}

function defaultExec(cmd: string, opts: { encoding: "utf-8"; stdio?: any }): string {
  return execSync(cmd, { ...opts, windowsHide: true }) as unknown as string;
}

// ── Elapsed-time parsing (pure, platform-agnostic) ──────────────────────────

/**
 * Parse `ps -o etime=` format into milliseconds. Handles:
 *   - `mm:ss`          (e.g. "02:15" → 135000)
 *   - `hh:mm:ss`       (e.g. "01:30:00" → 5400000)
 *   - `dd-hh:mm:ss`    (e.g. "2-03:00:00" → 183600000)
 *
 * Returns 0 for empty or unparseable input.
 */
export function parseEtime(etime: string): number {
  const trimmed = etime.trim();
  if (!trimmed) return 0;

  let days = 0;
  let rest = trimmed;

  const dashIdx = rest.indexOf("-");
  if (dashIdx !== -1) {
    days = parseInt(rest.slice(0, dashIdx), 10);
    if (isNaN(days)) return 0;
    rest = rest.slice(dashIdx + 1);
  }

  const parts = rest.split(":").map((p) => parseInt(p, 10));
  if (parts.some(isNaN)) return 0;

  let hours = 0, minutes = 0, seconds = 0;
  if (parts.length === 3) {
    [hours, minutes, seconds] = parts;
  } else if (parts.length === 2) {
    [minutes, seconds] = parts;
  } else {
    return 0;
  }

  return ((days * 86400) + (hours * 3600) + (minutes * 60) + seconds) * 1000;
}

// ── Process-running check ───────────────────────────────────────────────────

/**
 * Check whether a process matching `pattern` is currently running.
 *   - win32: `tasklist /FI "IMAGENAME eq <pattern>" /NH` — pattern is the
 *            executable image name (e.g. "Code.exe"). Returns true if the
 *            output contains the pattern.
 *   - unix:  `pgrep -f "<pattern>"` — pattern is any substring of the
 *            command-line (e.g. "/Applications/Zed.app"). Returns true if
 *            pgrep exits with code 0 (at least one match).
 *
 * Best-effort: any failure returns `false`.
 */
export function isProcessRunning(pattern: string, opts: ProcessScanOpts = {}): boolean {
  const platform = opts.platform ?? process.platform;
  const exec = opts.exec ?? defaultExec;
  try {
    if (platform === "win32") {
      const result = exec(`tasklist /FI "IMAGENAME eq ${pattern}" /NH`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
      return String(result).includes(pattern);
    }
    exec(`pgrep -f "${pattern}"`, { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ── Async scan primitives (managed services) ────────────────────────────────
//
// Async on purpose: the service layer calls these from the server event loop
// (exposure reporting, adoption, the attached-stop matcher), so a slow `lsof`
// or `ps` must never block it. Each takes an injectable `platform` + `run`.
// See change: add-service-registry-core (D5, D6).

/** Run `file args` and resolve stdout; reject on spawn failure or non-zero exit. */
export type ScanRunFn = (file: string, args: readonly string[]) => Promise<string>;

export interface ProcessScanAsyncOpts {
  /** Override platform (defaults to process.platform). */
  platform?: NodeJS.Platform;
  /** Override the command runner (for tests). */
  run?: ScanRunFn;
}

async function defaultRun(file: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync(file, args, { timeout: 5000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  return String(stdout);
}

/** Where a local port is bound: loopback only, any non-loopback address, or not determinable. */
export type ListenExposure = "loopback" | "all-interfaces" | "unknown";

/** Output dialects understood by {@link parseListenHosts}. */
export type ListenOutputFormat = "lsof" | "netstat-posix" | "netstat-win";

/** Split `host:port` / `host.port` (BSD netstat) into its host when the port matches. */
function hostForPort(token: string, port: number): string | null {
  const m = /^(.*)[:.](\d+)$/.exec(token);
  if (!m || Number(m[2]) !== port) return null;
  return m[1];
}

/**
 * Pure parser: the LOCAL listen hosts for `port` in `lsof -nP -iTCP:<p>
 * -sTCP:LISTEN`, POSIX `netstat -an`, or win32 `netstat -ano` output.
 * netstat rows are restricted to LISTEN(ING) rows and their local-address
 * column, so an established connection to a remote `:<port>` never counts.
 */
export function parseListenHosts(output: string, port: number, format: ListenOutputFormat): string[] {
  const hosts: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 2) continue;
    if (format === "lsof") {
      for (const token of cols) {
        const host = hostForPort(token, port);
        if (host !== null) { hosts.push(host); break; }
      }
      continue;
    }
    if (!/LISTEN/i.test(line)) continue;
    const local = format === "netstat-win" ? cols[1] : cols[3];
    const host = local ? hostForPort(local, port) : null;
    if (host !== null) hosts.push(host);
  }
  return hosts;
}

const WILDCARD_HOSTS = new Set(["*", "0.0.0.0", "::", "[::]", ""]);

function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "::1" || h === "localhost" || /^127\./.test(h) || h === "::ffff:127.0.0.1";
}

/** Pure: no host → `unknown`; any wildcard or non-loopback host → `all-interfaces`. */
export function classifyListenHosts(hosts: readonly string[]): ListenExposure {
  if (hosts.length === 0) return "unknown";
  for (const h of hosts) {
    if (WILDCARD_HOSTS.has(h) || !isLoopbackHost(h)) return "all-interfaces";
  }
  return "loopback";
}

/**
 * Report how a local TCP port is bound. darwin/linux: `lsof -nP -iTCP:<p>
 * -sTCP:LISTEN`, falling back to `netstat -an`; win32: `netstat -ano`.
 * Best-effort and non-blocking for the caller: any failure → `unknown`.
 */
export async function findListenAddresses(port: number, opts: ProcessScanAsyncOpts = {}): Promise<ListenExposure> {
  const platform = opts.platform ?? process.platform;
  const run = opts.run ?? defaultRun;
  if (platform === "win32") {
    try {
      return classifyListenHosts(parseListenHosts(await run("netstat", ["-ano"]), port, "netstat-win"));
    } catch {
      return "unknown";
    }
  }
  try {
    const hosts = parseListenHosts(await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]), port, "lsof");
    if (hosts.length > 0) return classifyListenHosts(hosts);
  } catch {
    /* lsof missing or no match (exit 1) — fall back */
  }
  try {
    return classifyListenHosts(parseListenHosts(await run("netstat", ["-an"]), port, "netstat-posix"));
  } catch {
    return "unknown";
  }
}

/** One row of a process table: pid + executable path (or image name on win32). */
export interface ExecutableRow {
  pid: number;
  exe: string;
}

/**
 * Pure parser for the process tables {@link findProcessesByExecutable} reads:
 * darwin `ps -axo pid=,comm=` (full path), linux `ps -eo pid=,args=` (argv[0]
 * is taken), win32 `tasklist /FO CSV /NH`.
 */
export function parseExecutableRows(output: string, platform: NodeJS.Platform): ExecutableRow[] {
  const rows: ExecutableRow[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (platform === "win32") {
      const m = /^"([^"]*)","(\d+)"/.exec(line.trim());
      if (m) rows.push({ pid: Number(m[2]), exe: m[1] });
      continue;
    }
    const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const exe = platform === "darwin" ? m[2] : m[2].split(/\s+/)[0];
    rows.push({ pid: Number(m[1]), exe });
  }
  return rows;
}

/**
 * Pure matcher: the EXACT executable basename equals `name` — never a
 * command-line substring. Case-insensitive on darwin/win32; `.exe` ignored
 * on win32. Compared against the full path, so Linux's 15-char `comm`
 * truncation does not apply.
 */
export function matchesExecutable(exe: string, name: string, platform: NodeJS.Platform): boolean {
  const base = platform === "win32" ? path.win32.basename(exe) : path.posix.basename(exe);
  const norm = (s: string) => {
    let v = s;
    if (platform === "win32") v = v.replace(/\.exe$/i, "");
    return platform === "linux" ? v : v.toLowerCase();
  };
  return norm(base) === norm(name);
}

/** PIDs whose executable basename is exactly `name` (see {@link matchesExecutable}). Failure → []. */
export async function findProcessesByExecutable(name: string, opts: ProcessScanAsyncOpts = {}): Promise<number[]> {
  const platform = opts.platform ?? process.platform;
  const run = opts.run ?? defaultRun;
  let output: string;
  try {
    if (platform === "win32") output = await run("tasklist", ["/FO", "CSV", "/NH"]);
    else if (platform === "darwin") output = await run("ps", ["-axo", "pid=,comm="]);
    else output = await run("ps", ["-eo", "pid=,args="]);
  } catch {
    return [];
  }
  return parseExecutableRows(output, platform)
    .filter((r) => r.pid !== process.pid && matchesExecutable(r.exe, name, platform))
    .map((r) => r.pid);
}

/** The full command line of `pid`, or null when it cannot be read (dead, denied, no tool). */
export async function readProcessCommandLine(pid: number, opts: ProcessScanAsyncOpts = {}): Promise<string | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const platform = opts.platform ?? process.platform;
  const run = opts.run ?? defaultRun;
  try {
    const out =
      platform === "win32"
        ? await run("powershell", [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
          ])
        : await run("ps", ["-ww", "-p", String(pid), "-o", "args="]);
    const line = out.trim();
    return line.length > 0 ? line : null;
  } catch {
    return null;
  }
}
