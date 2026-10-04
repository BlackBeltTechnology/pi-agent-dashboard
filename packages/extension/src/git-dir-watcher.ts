/**
 * Non-recursive `fs.watch` on a session's git dir(s) (change:
 * optimize-polling-hot-paths, D6). Routes by filename:
 *   HEAD / packed-refs / *_HEAD  → fast lane (branch-affecting)
 *   index / null filename        → slow lane (dirtiness; null = unknown event)
 * `persistent: false` so a watcher never keeps pi alive. Modeled on
 * `packages/server/src/git-worktree/folder-head-watcher.ts`.
 *
 * An attach failure (ENOENT/EMFILE/EACCES/EPERM…) returns `false` and leaves
 * the 30 s tick's slow-lane probe as the fallback.
 */
import { type FSWatcher, watch as fsWatch } from "node:fs";
import type { ProbeLane } from "./git-probe-scheduler.js";

export type WatchFn = (
  dir: string,
  opts: { persistent: boolean },
  listener: (event: string, filename: string | Buffer | null) => void,
) => Pick<FSWatcher, "close" | "on">;

export interface GitDirWatcherDeps {
  /** Called for every routed event. */
  onEvent: (lane: ProbeLane) => void;
  watch?: WatchFn;
}

export interface GitDirWatcher {
  /** Attach to `gitDir` (+ `commonDir` when different). Returns whether ≥ 1 watch attached. */
  attach(gitDir: string, commonDir?: string): boolean;
  detach(): void;
}

/** Filename → lane; `undefined` = irrelevant (lock files, objects, …). */
export function laneForGitDirFile(filename: string | null): ProbeLane | undefined {
  if (filename === null) return "slow";
  if (filename === "HEAD" || filename === "packed-refs" || filename.endsWith("_HEAD")) {
    return "fast";
  }
  if (filename === "index") return "slow";
  return undefined;
}

export function createGitDirWatcher(deps: GitDirWatcherDeps): GitDirWatcher {
  const watch: WatchFn = deps.watch ?? ((dir, opts, listener) => fsWatch(dir, opts, listener));
  let watchers: Array<Pick<FSWatcher, "close" | "on">> = [];

  return {
    attach(gitDir, commonDir) {
      this.detach();
      const dirs = commonDir && commonDir !== gitDir ? [gitDir, commonDir] : [gitDir];
      for (const dir of dirs) {
        try {
          const w = watch(dir, { persistent: false }, (_event, filename) => {
            const name = filename === null ? null : filename.toString();
            const lane = laneForGitDirFile(name);
            if (lane) deps.onEvent(lane);
          });
          w.on("error", () => {
            /* a dead watcher must never throw; the tick probe still covers it */
          });
          watchers.push(w);
        } catch {
          /* not attached */
        }
      }
      return watchers.length > 0;
    },
    detach() {
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* already closed */
        }
      }
      watchers = [];
    },
  };
}
