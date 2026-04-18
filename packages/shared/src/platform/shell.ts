/**
 * Cross-platform shell and terminal-environment primitives.
 *
 * `detectShell` and `getTerminalEnvHints` accept an injectable `platform`
 * and `env` parameters (defaulting to `process.platform` and `process.env`)
 * so tests can exercise both branches without global mutation.
 * See change: consolidate-platform-handlers.
 */

export interface ShellOpts {
  /** Override platform (defaults to process.platform). */
  platform?: NodeJS.Platform;
  /** Override env (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
}

/**
 * Detect the appropriate shell for the current platform:
 *   - win32: `%COMSPEC%` if set, else `"powershell.exe"`
 *   - unix:  `$SHELL` if set, else `"/bin/bash"`
 */
export function detectShell(opts: ShellOpts = {}): string {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  if (platform === "win32") {
    return env.COMSPEC || "powershell.exe";
  }
  return env.SHELL || "/bin/bash";
}

/**
 * Extra environment variables to set when spawning a PTY, per platform.
 * Currently only Windows sets `TERM=cygwin` (when not already set) so that
 * curses/readline-style apps render correctly in node-pty on Windows.
 */
export function getTerminalEnvHints(opts: ShellOpts = {}): Record<string, string> {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const hints: Record<string, string> = {};
  if (platform === "win32" && !env.TERM) {
    hints.TERM = "cygwin";
  }
  return hints;
}
