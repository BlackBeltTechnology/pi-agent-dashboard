/**
 * PID-scoped server-exit ownership during a runtime switch.
 *
 * `switchRuntime()` must not flip the GLOBAL graceful flag — a crash of the
 * surviving/committed runtime must always reach the watchdog. Instead:
 *   - expectExit(pid)     — planned stop; that PID's exit is graceful.
 *   - claimCandidate(pid) — until commit/rollback, the candidate's exit is
 *                           handled by switchRuntime (rollback), not the watchdog.
 * Every switch path ends with releaseRuntimeSwitchOwnership() in a finally.
 * Leaf module (no imports) so the watchdog and the switch share it without a cycle.
 *
 * See change: electron-runtime-overlay-updates (D3; test-plan X8).
 */
const expectedExitPids = new Set<number>();
const claimedCandidatePids = new Set<number>();

export function expectExit(pid: number): void {
  expectedExitPids.add(pid);
}

export function claimCandidate(pid: number): void {
  claimedCandidatePids.add(pid);
}

/** Clear every switch-scoped expectation/claim (commit, rollback, abort). */
export function releaseRuntimeSwitchOwnership(): void {
  expectedExitPids.clear();
  claimedCandidatePids.clear();
}

/** How the watchdog must treat an exit of `pid`. Consumes a planned-exit entry. */
export function takeExitOwnership(pid: number): "candidate" | "planned" | "watchdog" {
  if (claimedCandidatePids.has(pid)) return "candidate";
  if (expectedExitPids.delete(pid)) return "planned";
  return "watchdog";
}
