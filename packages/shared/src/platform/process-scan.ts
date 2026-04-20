/**
 * Cross-platform process enumeration primitives: is-process-running,
 * ps/tasklist pattern-matching, elapsed-time parsing.
 *
 * Every OS-dependent helper accepts injectable `platform` and `exec`
 * parameters (defaulting to `process.platform` and `execSync`), so tests
 * can exercise both branches without mutating the global `process.platform`.
 * See change: consolidate-platform-handlers.
 */

import { execSync } from "./exec.js";

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
