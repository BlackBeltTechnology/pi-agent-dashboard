/**
 * Pure poll-tick body, extracted from bridge.ts so the session-start timer and
 * the session-change timer share ONE implementation and can never drift.
 * Previously the two `setInterval` loops were duplicated; the session-change
 * copy dropped name/model polling, so session renames and model changes
 * stopped propagating after any new/fork/resume.
 * See change: fix-stale-ctx-cwd-crash.
 *
 * Contract:
 * - Inactive tick (isActive() === false): no-op.
 * - cwd present: run the git tick (cheap checks + a probe REQUEST — git itself
 *   runs async in the probe scheduler) and the cwd-missing check.
 * - cwd absent (e.g. cachedCwd unset after a stale-ctx session swap): skip
 *   git/cwd checks, but STILL run name + model checks every active tick.
 * - pi version is re-read on ticks 1, 11, 21, …; a failed read retries on the
 *   next tick. See change: optimize-polling-hot-paths (D7).
 * - A rejecting git tick is logged once and never blocks the rest of the tick
 *   or the next tick.
 */
export interface GitPollDeps {
  isActive: () => boolean;
  /** Cached ctx.cwd. ctx.cwd is a throwing getter post session-swap, so the
   *  caller caches it and exposes the snapshot here. */
  cachedCwd: () => string | undefined;
  /** Git part of the tick: facts stamp, HEAD-file branch, one probe request. */
  tickGit: (cwd: string) => void | Promise<void>;
  sendCwdMissingIfChanged: (cwd: string) => void;
  sendSessionNameIfChanged: () => void;
  sendModelUpdateIfChanged: () => void;
  /** Re-read pi version; push pi_version_update only on change. Returns whether the read succeeded. */
  sendPiVersionIfChanged: () => boolean | void;
  /** Per-incarnation cadence state (see {@link createGitPollState}). */
  state: GitPollState;
  log?: (line: string) => void;
}

export interface GitPollState {
  tick: number;
  versionRetry: boolean;
  gitErrorLogged: boolean;
}

export function createGitPollState(): GitPollState {
  return { tick: 0, versionRetry: false, gitErrorLogged: false };
}

/** Read the version on ticks 1, 11, 21, … (and retry after a failed read). */
const VERSION_EVERY_N_TICKS = 10;

export async function runGitPollTick(deps: GitPollDeps): Promise<void> {
  if (!deps.isActive()) return;
  const state = deps.state;
  state.tick += 1;
  const cwd = deps.cachedCwd();
  if (cwd) {
    try {
      await deps.tickGit(cwd);
    } catch (err) {
      if (!state.gitErrorLogged) {
        state.gitErrorLogged = true;
        (deps.log ?? ((l: string) => console.error(l)))(`[dashboard] git poll tick failed: ${String(err)}`);
      }
    }
    deps.sendCwdMissingIfChanged(cwd);
  }
  deps.sendSessionNameIfChanged();
  deps.sendModelUpdateIfChanged();
  if (state.versionRetry || (state.tick - 1) % VERSION_EVERY_N_TICKS === 0) {
    state.versionRetry = deps.sendPiVersionIfChanged() === false;
  }
}
