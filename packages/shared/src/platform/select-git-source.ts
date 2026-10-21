/**
 * selectGitSource — decide whether git/bash come from the host PATH or
 * the bundled `resources/git/` tree on Windows.
 *
 * Tri-state setting `windowsGitSource`:
 *   - "auto"    : prefer host when BOTH git and a shell are on host PATH,
 *                 else bundled (atomic — never mix host git + bundled sh).
 *   - "host"    : host when present; bundled fallback when absent (Doctor
 *                 surfaces the mismatch as an error row).
 *   - "bundled" : always bundled.
 *
 * On non-Windows hosts the result is always "host": macOS/Linux ship git
 * and /bin/sh system-wide, and the bundle does not exist there.
 *
 * Pure + injectable (`which`, `env`, `platform`) for unit testing the
 * truth table. See change: embed-git-bash-on-windows (proposal §3).
 */

export type GitSource = "host" | "bundled";
export type WindowsGitSourceSetting = "auto" | "host" | "bundled";

/**
 * Windows-only: where `usr/bin` of the bundled git tree sits on the spawn PATH
 * (decides which `bash.exe` pi resolves). No effect unless the git source is
 * "bundled". See change: fix-windows-bundled-bash-exe.
 */
export type WindowsBashSourceSetting = "bundled" | "host";

export interface SelectGitSourceOpts {
  /** Config value. Default "auto". */
  setting?: WindowsGitSourceSetting;
  /** Override `process.platform` for tests. */
  platform?: NodeJS.Platform;
  /** Override env (unused today; reserved for PATH-based probes). */
  env?: NodeJS.ProcessEnv;
  /**
   * Resolve a command on host PATH (e.g. `where.exe git`). Returns the
   * absolute path or `null`. Tests inject a stub; production passes the
   * shared `whichSync`.
   */
  which?: (cmd: string) => string | null;
}

/**
 * Returns true iff the host has BOTH `git` and a POSIX shell (`bash`)
 * on PATH. Git for Windows ships `bash.exe`; the atomicity rule (D2)
 * requires both before we trust host tools.
 */
function hostHasGitAndShell(which: (cmd: string) => string | null): boolean {
  return which("git") !== null && which("bash") !== null;
}

/**
 * Resolve the active git source. Returns "host" or "bundled".
 *
 * Doctor derives its "host requested but missing" error by comparing the
 * requested `setting` against this result: setting "host" yielding
 * "bundled" means the host tools were absent.
 */
export function selectGitSource(opts: SelectGitSourceOpts = {}): GitSource {
  const platform = opts.platform ?? process.platform;
  if (platform !== "win32") return "host";

  const setting = opts.setting ?? "auto";
  if (setting === "bundled") return "bundled";

  const which = opts.which ?? (() => null);

  if (setting === "host") {
    // Host requested: use it when present, else bundled fallback so the
    // dashboard stays functional. Doctor flags the fallback.
    return hostHasGitAndShell(which) ? "host" : "bundled";
  }

  // "auto": host wins only when both tools are present (atomic).
  return hostHasGitAndShell(which) ? "host" : "bundled";
}
