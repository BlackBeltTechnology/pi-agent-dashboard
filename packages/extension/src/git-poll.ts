/**
 * Pure git + name/model poll-tick body, extracted from bridge.ts so the
 * session-start timer and the session-change timer share ONE implementation
 * and can never drift. Previously the two `setInterval` loops were duplicated;
 * the session-change copy dropped name/model polling, so session renames and
 * model changes stopped propagating after any new/fork/resume.
 * See change: fix-stale-ctx-cwd-crash.
 *
 * Contract:
 * - Inactive tick (isActive() === false): no-op.
 * - cwd present: run git + cwd-missing checks (these need a directory).
 * - cwd absent (e.g. cachedCwd unset after a stale-ctx session swap): skip
 *   git/cwd checks, but STILL run name + model checks every active tick.
 */
export interface GitPollDeps {
  isActive: () => boolean;
  /** Cached ctx.cwd. ctx.cwd is a throwing getter post session-swap, so the
   *  caller caches it and exposes the snapshot here. */
  cachedCwd: () => string | undefined;
  sendGitInfoIfChanged: (cwd: string) => void;
  sendCwdMissingIfChanged: (cwd: string) => void;
  sendSessionNameIfChanged: () => void;
  sendModelUpdateIfChanged: () => void;
  /** Re-read pi version; push pi_version_update only on change. */
  sendPiVersionIfChanged: () => void;
}

export function runGitPollTick(deps: GitPollDeps): void {
  if (!deps.isActive()) return;
  const cwd = deps.cachedCwd();
  if (cwd) {
    deps.sendGitInfoIfChanged(cwd);
    deps.sendCwdMissingIfChanged(cwd);
  }
  deps.sendSessionNameIfChanged();
  deps.sendModelUpdateIfChanged();
  deps.sendPiVersionIfChanged();
}
