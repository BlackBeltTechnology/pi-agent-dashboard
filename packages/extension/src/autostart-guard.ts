/**
 * Auto-start guards: the worktree refusal predicate (D3) and the durable
 * auto-start log (D4).
 *
 * A pi session running inside a git worktree resolves its dashboard server
 * CLI from that worktree (`resolveServerCliPath()`), so its auto-start would
 * spawn the worktree's server on the SHARED default ports and hijack the host
 * dashboard's gateway. Refusal keys on the resolved **cliPath** (which code is
 * spawned), never on cwd (where the session sits).
 *
 * See change: fix-worktree-server-autostart-leak.
 */
import { appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, sep } from "node:path";
import { getDashboardServerLogPath } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
// Re-exported from the config module so the predicate can never desync from
// the actual defaults it is protecting.
export {
  DEFAULT_DASHBOARD_PORT,
  DEFAULT_GATEWAY_PORT,
} from "@blackbelt-technology/pi-dashboard-shared/config.js";
import {
  DEFAULT_DASHBOARD_PORT,
  DEFAULT_GATEWAY_PORT,
} from "@blackbelt-technology/pi-dashboard-shared/config.js";

/** The path segment that marks a worktree checkout. */
const WORKTREE_SEGMENT = ".worktrees";

/**
 * True when `p` contains a `.worktrees` **path segment**. Segment-aware, so
 * `/repo/.worktrees-backup/os-x/...` does NOT match (E18).
 */
function hasWorktreeSegment(p: string): boolean {
  // Normalise both separators so a Windows path is matched the same way.
  const parts = p.split(/[\\/]/);
  return parts.includes(WORKTREE_SEGMENT);
}

/**
 * Worktree predicate over a resolved CLI path.
 *
 * Clarification C3: match on **both** the pre-realpath and the post-realpath
 * spelling. `realpath` strips a `.worktrees` segment reached via a symlink
 * (so post-realpath alone misses symlinked worktrees), while pre-realpath
 * alone misses a symlink that POINTS INTO a real worktree. Either limb
 * matching is a refusal.
 */
export function isWorktreeCliPath(
  cliPath: string,
  realpath: (p: string) => string = realpathSync,
): boolean {
  if (hasWorktreeSegment(cliPath)) return true;
  let resolved: string;
  try {
    resolved = realpath(cliPath);
  } catch {
    // Path does not exist yet — the literal spelling is all we have.
    return false;
  }
  return hasWorktreeSegment(resolved);
}

/**
 * Should this session refuse to auto-start a dashboard server?
 *
 * Refuse when the resolved cliPath is a worktree AND it would take at least
 * one shared default port (D3 / E15: gateway-port-only evasion also refuses).
 * A fully isolated worktree dashboard (both ports moved off their defaults —
 * what `isolated-ui-verification` already allocates) is permitted (E16).
 */
export function shouldRefuseWorktreeAutoStart(
  args: { cliPath: string; port: number; piPort: number },
  realpath?: (p: string) => string,
): boolean {
  if (!isWorktreeCliPath(args.cliPath, realpath)) return false;
  return args.port === DEFAULT_DASHBOARD_PORT || args.piPort === DEFAULT_GATEWAY_PORT;
}

/**
 * Append one line to the dashboard server log.
 *
 * D4: `deps.notify` is a transient TUI toast (invisible headless), so refusal
 * and lock-loss must be greppable on disk. The refusal path SKIPS the launch
 * primitive that normally creates this file, so we create the directory and
 * the file ourselves. Best-effort: logging must never break auto-start.
 */
export function appendAutoStartLog(
  message: string,
  opts: { logPath?: string; now?: () => Date } = {},
): void {
  const logPath = opts.logPath ?? getDashboardServerLogPath();
  const stamp = (opts.now?.() ?? new Date()).toISOString();
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `[${stamp}] [auto-start] ${message}\n`);
  } catch {
    /* best-effort — never throw out of the auto-start path */
  }
}

/** Exposed for tests that need the platform separator in a fixture path. */
export const PATH_SEP = sep;
