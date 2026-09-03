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
  /**
   * Optional model id appended as `--model <model>`. Used by the
   * automation-plugin run spawn to pin a resolved provider/model.
   * See change: add-automation-plugin.
   */
  model?: string;
  /**
   * Optional session name appended as `--name <name>` (pi 0.78.0+). Set the
   * pi session name AT CREATION so worktree / flow spawns land with an
   * intended title instead of relying only on post-hoc auto-naming. Composes
   * with `--session` / `--fork` / `--model`. Empty / absent → no `--name`.
   * See change: adopt-pi-074-080-features.
   */
  name?: string;
  /**
   * Capability-scope fields mapped 1:1 to pi CLI flags. Populated by
   * `pluginSpawnToSessionOptions` from a plugin's `scope` block. Flat
   * primitives (not a nested sub-object), matching the `model`/`name`
   * convention; the argv builder wants primitives. Each is optional and,
   * when absent, emits nothing — so absent-scope argv is byte-identical to
   * the pre-change output. There is deliberately NO `noExtensions` field:
   * disabling extension discovery would stop the dashboard bridge from
   * loading and make the spawned session uncontrollable (design D2/D6).
   * See change: add-plugin-spawn-scope.
   */
  tools?: string[];
  excludeTools?: string[];
  noBuiltinTools?: boolean;
  noTools?: boolean;
  skills?: string[];
  noSkills?: boolean;
  extensions?: string[];
}

/**
 * Return `["--session", file]` or `["--fork", file]` or `[]`, followed by
 * any capability-scope flags. Every mechanism MUST use this to append flags;
 * dropping them silently is the exact bug that motivated this change (B1, B2).
 */
export function sessionFlagsToArgv(flags: SessionFlags): string[] {
  const scope = scopeFlags(flags);
  if (flags.sessionFile && flags.mode === "continue") {
    return [...nameFlag(flags), "--session", flags.sessionFile, ...scope];
  }
  if (flags.sessionFile && flags.mode === "fork") {
    return [...nameFlag(flags), "--fork", flags.sessionFile, ...modelFlag(flags), ...scope];
  }
  return [...nameFlag(flags), ...modelFlag(flags), ...scope];
}

/**
 * Emit capability-scope flags: comma-joined single arg for allowlists
 * (`--tools`/`--exclude-tools`), repeatable `--skill <path>` / `-e <path>`,
 * and bare boolean toggles. Each only when present; an empty array emits
 * nothing. Appended after session/model/name so absent-scope argv is
 * byte-identical. See change: add-plugin-spawn-scope.
 */
function scopeFlags(flags: SessionFlags): string[] {
  const argv: string[] = [];
  if (flags.tools && flags.tools.length > 0) argv.push("--tools", flags.tools.join(","));
  if (flags.excludeTools && flags.excludeTools.length > 0)
    argv.push("--exclude-tools", flags.excludeTools.join(","));
  if (flags.noBuiltinTools) argv.push("--no-builtin-tools");
  if (flags.noTools) argv.push("--no-tools");
  for (const skill of flags.skills ?? []) argv.push("--skill", skill);
  if (flags.noSkills) argv.push("--no-skills");
  for (const ext of flags.extensions ?? []) argv.push("-e", ext);
  return argv;
}

function modelFlag(flags: SessionFlags): string[] {
  return flags.model ? ["--model", flags.model] : [];
}

/**
 * `["--name", name]` when `name` is a non-empty string, else `[]`. The name is
 * a single argv element (never shell-split), so quotes / spaces in the title
 * pass through verbatim with no injection surface. See change:
 * adopt-pi-074-080-features.
 */
function nameFlag(flags: SessionFlags): string[] {
  return flags.name ? ["--name", flags.name] : [];
}
