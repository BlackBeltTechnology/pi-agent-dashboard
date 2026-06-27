/**
 * Folder-HEAD poll — server-side refresh of the sidebar folder-header branch.
 *
 * The folder-header branch (`GroupGitInfo` in the client) must reflect a
 * folder's OWN current git HEAD, even when the HEAD changes outside the
 * dashboard (e.g. `git checkout` in a terminal) and when no session is rooted
 * directly at the folder (the worktree-parent case).
 *
 * Work set = the paths the client renders as folder groups:
 *   unique({ resolveSessionGroupPath(s) : s.status !== "ended" }) ∪ pinnedDirectories
 * keyed via the shared `pathKey`/`inferPlatform` so server keys match the
 * client's `group.cwd` byte-for-byte. This is INTENTIONALLY computed
 * independently of `computeKnownDirectories()` (raw session cwds), which omits
 * `gitWorktree.mainPath` and so never reaches the worktree-parent folder.
 *
 * Per cwd: `readHead(cwd)` → derive a display branch (branch name, or short
 * SHA for detached HEAD, or `null` for a non-git folder) → diff against an
 * internal cache → broadcast `git_head_update` only on first-seen or change.
 *
 * See change: refresh-folder-header-branch.
 */
import {
  inferPlatform,
  pathKey,
  resolveSessionGroupPath,
} from "@blackbelt-technology/pi-dashboard-shared/session-group-path.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { BrowserGitHeadUpdateMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { readHead as defaultReadHead, type HeadInfo } from "./git-operations.js";

export type FolderGroupSession = Pick<
  DashboardSession,
  "cwd" | "gitWorktree" | "status"
>;

/**
 * Resolve the set of folder group-key DISPLAY paths the client renders, in a
 * stable order: pinned directories first (their display path wins on a key
 * collision, matching the client's pinned-group `cwd`), then each non-ended
 * session's resolved group path. De-duplicated by the shared `pathKey`.
 */
export function computeFolderGroupKeys(
  sessions: ReadonlyArray<FolderGroupSession>,
  pinnedDirectories: ReadonlyArray<string>,
  platformOverride?: NodeJS.Platform,
): string[] {
  const platform = inferPlatform(
    [...sessions.map((s) => s.cwd), ...pinnedDirectories],
    platformOverride,
  );
  const pinnedKeys = new Set(pinnedDirectories.map((d) => pathKey(d, platform)));
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (displayPath: string) => {
    const key = pathKey(displayPath, platform);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(displayPath);
  };
  // Pinned dirs first so their display path is authoritative on collision.
  for (const dir of pinnedDirectories) add(dir);
  for (const s of sessions) {
    if (s.status === "ended") continue;
    add(resolveSessionGroupPath(s, pinnedKeys, platform));
  }
  return out;
}

/**
 * Derive the display branch for a folder header from `readHead`:
 *   - branch name when on a branch
 *   - short SHA when detached (matches the `detectBranch` rule)
 *   - `null` when not a git repo / empty repo
 */
export function deriveDisplayBranch(head: HeadInfo): string | null {
  return head.branch ?? (head.detached ? head.sha : null);
}

export interface FolderHeadPollDeps {
  /** Broadcast a `git_head_update` to all browsers. */
  broadcast: (msg: BrowserGitHeadUpdateMessage) => void;
  /** Override for tests; defaults to the real `readHead`. */
  readHead?: (cwd: string) => HeadInfo;
  /** Optional logger for read failures; defaults to `console.warn`. */
  logger?: (msg: string) => void;
}

export interface FolderHeadPoll {
  /**
   * Recompute the group-key set from current sessions + pinned dirs, refresh
   * each, and return the set (so the caller can drive watcher attach/detach).
   */
  poll(
    sessions: ReadonlyArray<FolderGroupSession>,
    pinnedDirectories: ReadonlyArray<string>,
  ): string[];
  /** Refresh a single cwd (read → diff cache → broadcast). Watcher trigger. */
  refreshOne(cwd: string): void;
  /** Test helper: number of cached cwds. */
  size(): number;
}

export function createFolderHeadPoll(deps: FolderHeadPollDeps): FolderHeadPoll {
  const read = deps.readHead ?? defaultReadHead;
  const log = deps.logger ?? ((msg: string) => console.warn(msg));
  // cwd → last broadcast display branch (`null` = confirmed non-git).
  const cache = new Map<string, string | null>();

  function refreshOne(cwd: string): void {
    let branch: string | null;
    try {
      branch = deriveDisplayBranch(read(cwd));
    } catch (err) {
      // readHead never throws today (tryRun swallows), but stay defensive:
      // a throw means "could not determine" → treat as non-git (null).
      log(`[folder-head-poll] readHead threw for ${cwd}: ${(err as Error).message}`);
      branch = null;
    }
    // Broadcast on first observation or on change only (dedup parity with the
    // openspec poll). `cache.has` distinguishes first-seen from a cached null.
    if (cache.has(cwd) && cache.get(cwd) === branch) return;
    cache.set(cwd, branch);
    deps.broadcast({ type: "git_head_update", cwd, branch });
  }

  function poll(
    sessions: ReadonlyArray<FolderGroupSession>,
    pinnedDirectories: ReadonlyArray<string>,
  ): string[] {
    const keys = computeFolderGroupKeys(sessions, pinnedDirectories);
    for (const cwd of keys) refreshOne(cwd);
    return keys;
  }

  return { poll, refreshOne, size: () => cache.size };
}
