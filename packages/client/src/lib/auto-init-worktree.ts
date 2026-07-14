/**
 * Post-spawn worktree auto-init trigger.
 *
 * When the `autoInitWorktreeOnSpawn` preference is ON, a freshly spawned
 * worktree auto-runs its declared `worktreeInit` hook — but ONLY when the
 * hook is already TOFU-trusted and the gate reports `needsInit`. Untrusted
 * hooks never auto-run: the manual `WorktreeInitButton` stays the only path
 * to grant trust (the trust gate is enforced server-side regardless).
 *
 * The auto-trigger never sends a `confirmHash`, so an untrusted hook that
 * slips past the client probe still returns `init_untrusted` server-side
 * and does not execute.
 *
 * Feedback is NOT silent (change: friendlier-worktree-init): the run is
 * registered in the cwd-keyed `worktree-init-store`, so its running / done /
 * failed states surface on the new worktree's row + concurrent stack. A failed
 * auto-init is now visible + retryable instead of a silently-broken worktree.
 *
 * See change: auto-init-worktree-on-spawn, friendlier-worktree-init.
 */
import {
  fetchAutoInitWorktreePref,
  fetchWorktreeInitStatus,
  runWorktreeInit,
  type WorktreeInitResult,
} from "./git-api.js";
import { initStore } from "./worktree-init-store.js";

/** Route a run result to the store (done-flash / failed-sticky / clear). */
function applyRunResult(cwd: string, res: WorktreeInitResult): void {
  if (res.ok) {
    if (res.ran) initStore.markDone(cwd);
    else initStore.dismiss(cwd); // already_initialized / no_hook — no ws terminal
  } else if (res.untrusted) {
    initStore.dismiss(cwd); // should not happen (probe said trusted)
  } else {
    initStore.markFailed(cwd, res.code, res.error, res.stderr);
  }
}

/**
 * Fire-and-forget auto-init for a newly spawned worktree `cwd`.
 *
 * No-op unless: preference ON AND init-status reports
 * `{ hasHook: true, needsInit: true, trusted: true }`. Returns `true` when
 * it issued a `runWorktreeInit` call, `false` otherwise (for tests/diagnostics).
 */
export async function maybeAutoInitWorktreeOnSpawn(cwd: string): Promise<boolean> {
  if (!cwd) return false;
  // Invoked fire-and-forget from spawn callbacks; swallow any failure so a
  // rejected probe/run never surfaces as an unhandled rejection.
  let started = false;
  try {
    const enabled = await fetchAutoInitWorktreePref();
    if (!enabled) return false;

    const status = await fetchWorktreeInitStatus(cwd);
    if (status.hasHook !== true || status.needsInit !== true || status.trusted !== true) {
      return false;
    }

    // Trusted + needs init → run. Register the run by cwd so its progress /
    // failure is visible; the store subscribes to the ws stream. Never pass
    // confirmHash (TOFU invariant).
    initStore.startRun(cwd);
    started = true;
    applyRunResult(cwd, await runWorktreeInit({ cwd }));
    return true;
  } catch (error) {
    console.warn("[worktree-auto-init] failed", { cwd, error });
    // Only surface a failure chip if the run actually started; a probe-stage
    // error must not fabricate a failed entry for a cwd that never ran.
    if (started) initStore.markFailed(cwd, "network_failure", error instanceof Error ? error.message : "auto-init failed");
    return false;
  }
}
