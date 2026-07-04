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
 * The per-folder HEAD reads run ASYNC + concurrency-bounded (default reader
 * `readHeadDisplayAsync`, via `execFile`) so the reads never form one
 * synchronous `execSync` burst on the poll `setInterval` turn (the attributed
 * `tickOpen` ~700ms stall). See changes: refresh-folder-header-branch,
 * attribute-openspec-poll-eventloop-stalls.
 */

import type { BrowserGitHeadUpdateMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import {
  inferPlatform,
  pathKey,
  resolveSessionGroupPath,
} from "@blackbelt-technology/pi-dashboard-shared/session-group-path.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { readHeadDisplayAsync as defaultReadHead, type HeadInfo } from "./git-operations.js";

/** Default max concurrent folder-head git reads per poll fan-out. */
const DEFAULT_FOLDER_HEAD_CONCURRENCY = 4;

/**
 * Run `fn` over `items` with at most `limit` in flight. Preserves per-item
 * independence (results indexed by position); order of completion is not
 * guaranteed, which is fine — `git_head_update` is keyed per cwd.
 */
async function mapBounded<T>(
  items: ReadonlyArray<string>,
  limit: number,
  fn: (item: string) => Promise<T>,
): Promise<void> {
  const cap = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const idx = next++;
      await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: cap }, worker));
}

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
  /**
   * Override for tests; defaults to the async `readHeadDisplayAsync`. May be
   * sync or async — the poll always awaits it. See change:
   * attribute-openspec-poll-eventloop-stalls.
   */
  readHead?: (cwd: string) => Promise<HeadInfo> | HeadInfo;
  /** Optional logger for read failures; defaults to `console.warn`. */
  logger?: (msg: string) => void;
  /** Max concurrent HEAD reads per `poll` fan-out. Default 4. */
  concurrency?: number;
}

export interface FolderHeadPoll {
  /**
   * Recompute the group-key set from current sessions + pinned dirs, refresh
   * each (async, concurrency-bounded), and resolve with the set (so the caller
   * can drive watcher attach/detach). Resolves only after every HEAD read +
   * broadcast for this fan-out has completed — callers `await` it to preserve
   * `git_head_update`-before-`openspec_update` ordering.
   */
  poll(
    sessions: ReadonlyArray<FolderGroupSession>,
    pinnedDirectories: ReadonlyArray<string>,
  ): Promise<string[]>;
  /** Refresh a single cwd (read → diff cache → broadcast). Watcher trigger. */
  refreshOne(cwd: string): Promise<void>;
  /** Test helper: number of cached cwds. */
  size(): number;
}

export function createFolderHeadPoll(deps: FolderHeadPollDeps): FolderHeadPoll {
  const read = deps.readHead ?? defaultReadHead;
  const log = deps.logger ?? ((msg: string) => console.warn(msg));
  const concurrency = deps.concurrency ?? DEFAULT_FOLDER_HEAD_CONCURRENCY;
  // cwd → last broadcast display branch (`null` = confirmed non-git).
  const cache = new Map<string, string | null>();

  async function refreshOne(cwd: string): Promise<void> {
    let branch: string | null;
    try {
      branch = deriveDisplayBranch(await read(cwd));
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

  async function poll(
    sessions: ReadonlyArray<FolderGroupSession>,
    pinnedDirectories: ReadonlyArray<string>,
  ): Promise<string[]> {
    const keys = computeFolderGroupKeys(sessions, pinnedDirectories);
    await mapBounded(keys, concurrency, refreshOne);
    return keys;
  }

  return { poll, refreshOne, size: () => cache.size };
}
