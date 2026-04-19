/**
 * Session-spawn mechanism selection.
 *
 * The user expresses preference via a two-valued config type
 * (`SpawnStrategy` = "tmux" | "headless"). The dashboard internally
 * decides WHICH actual mechanism to use given the OS and what's
 * available on this host. This module is the single source of truth
 * for that decision.
 *
 * Mechanisms:
 *   • "tmux"      — Unix terminal multiplexer (Linux, macOS)
 *   • "wt"        — Windows Terminal new-tab (Win10/11)
 *   • "wsl-tmux"  — WSL-hosted tmux (Windows, niche)
 *   • "headless"  — RPC-mode pi, no TTY, bridge over WebSocket
 *
 * `selectMechanism` is pure: no I/O, no subprocess calls. Availability
 * is determined by the caller (typically via `ToolRegistry.resolve`)
 * and passed in. This keeps the decision trivially testable.
 *
 * See change: consolidate-windows-spawn-and-platform-handlers.
 */

export type SpawnMechanism = "tmux" | "wt" | "wsl-tmux" | "headless";

/** User-visible config value (from `SpawnStrategy` in shared/config.ts). */
export type UserSpawnStrategy = "tmux" | "headless";

export interface SpawnMechanismContext {
  platform: NodeJS.Platform;
  userStrategy: UserSpawnStrategy;
  electronMode: boolean;
  available: {
    tmux: boolean;
    wt: boolean;
    wslTmux: boolean;
  };
}

/**
 * Select one spawn mechanism for this platform given the user's
 * preference, the electron-mode flag, and tool availability.
 *
 * Rules (in order):
 *   1. electronMode forces "headless".
 *   2. userStrategy "headless" forces "headless".
 *   3. Unix (linux/darwin): tmux if available, else headless.
 *   4. Windows: wt > wsl-tmux > headless.
 *   5. Any other platform falls back to headless.
 */
export function selectMechanism(ctx: SpawnMechanismContext): SpawnMechanism {
  if (ctx.electronMode) return "headless";
  if (ctx.userStrategy === "headless") return "headless";

  if (ctx.platform === "linux" || ctx.platform === "darwin") {
    return ctx.available.tmux ? "tmux" : "headless";
  }
  if (ctx.platform === "win32") {
    if (ctx.available.wt) return "wt";
    if (ctx.available.wslTmux) return "wsl-tmux";
    return "headless";
  }
  return "headless";
}

// ── Windows Terminal argv builder ───────────────────────────────────────────

export interface WtArgsOptions {
  /** Absolute cwd for the new tab. Spaces / parens / quotes are safe in argv form. */
  cwd: string;
  /** Tab title, typically the basename of cwd. */
  title: string;
  /**
   * Pre-resolved pi argv: typically [node.exe, cli.js, --mode?, rpc?, --fork?, file?].
   * Interactive wt sessions OMIT --mode rpc so pi runs its TUI.
   */
  piArgv: string[];
}

/**
 * Build argv (NOT a shell string) to invoke Windows Terminal so it opens
 * a new tab in the existing WT window and runs `piArgv` there.
 *
 * Design notes:
 *   • argv form — passed to spawn with shell:false, so wt re-parses it
 *     internally. No need to escape spaces, semicolons, or quotes in cwd.
 *   • `-w 0` reuses the most-recently-used WT window; new tab, not new
 *     window. Matches tmux `new-window` semantics.
 *   • No `-p <profile>` — respect the user's default WT profile
 *     (cmd / pwsh / WSL).
 *   • `--` sentinel before piArgv so any `-` or `/` prefix in piArgv
 *     can't be misparsed as a wt option.
 */
export function buildWtArgs(opts: WtArgsOptions): string[] {
  return [
    "-w", "0",
    "new-tab",
    "-d", opts.cwd,
    "--title", opts.title,
    "--",
    ...opts.piArgv,
  ];
}

// ── Shared helper: append session/fork flags uniformly ─────────────────────

export interface SessionFlags {
  sessionFile?: string;
  mode?: "continue" | "fork";
}

/**
 * Return `["--session", file]` or `["--fork", file]` or `[]`.
 * Every mechanism MUST use this to append flags; dropping them silently
 * is the exact bug that motivated this change (B1, B2).
 */
export function sessionFlagsToArgv(flags: SessionFlags): string[] {
  if (flags.sessionFile && flags.mode === "continue") {
    return ["--session", flags.sessionFile];
  }
  if (flags.sessionFile && flags.mode === "fork") {
    return ["--fork", flags.sessionFile];
  }
  return [];
}
