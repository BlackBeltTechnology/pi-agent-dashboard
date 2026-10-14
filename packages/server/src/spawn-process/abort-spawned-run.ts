/**
 * Terminate an automation run's spawned session (stop / run completion).
 *
 * Both the `graceful` and hard branches go through the ONE shared terminator —
 * the registry only knows headless spawns, so a registry-only kill leaked every
 * tmux-default run. The terminator also reclaims a spawn that has not registered
 * yet (spawn token), the pre-register window.
 *
 * Returns `true` only when the process is confirmed dead. Anything else
 * (unconfirmed, refused identity, no identity) is reported — one warn naming the
 * run — and counted as a failed reclaim; it does NOT feed the reaper's give-up
 * tracker (a run is terminated once, not swept). The caller (server.ts) keeps
 * the plugin trust gate.
 *
 * See change: fix-session-reclaim-tmux (design D6), fix-automation-stop-zombie-runs.
 */
import type { Terminate } from "./session-terminator.js";

export interface AbortSpawnedRunDeps {
  terminate: Terminate;
  /** Best-effort `{type:"shutdown"}` hint to the bridge (dropped when its WS is not OPEN). */
  sendShutdownHint: (sessionId: string) => boolean;
  /** `embedLifecycle.metrics.recordReclaimFailure`. */
  recordReclaimFailure: () => void;
  warn?: (message: string) => void;
}

export interface AbortSpawnedRunArgs {
  sessionId?: string;
  spawnToken?: string;
  graceful?: boolean;
}

export function createAbortSpawnedRun(
  deps: AbortSpawnedRunDeps,
): (args: AbortSpawnedRunArgs) => Promise<boolean> {
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  return async ({ sessionId, spawnToken, graceful }) => {
    if (!sessionId && !spawnToken) return false;
    if (graceful && sessionId) deps.sendShutdownHint(sessionId);
    const result = await deps.terminate(sessionId ?? "", {
      spawnToken,
      verifyIdentity: true,
      stampManualClose: true,
    });
    if (result.terminated) return true;
    const who = sessionId ? `session ${sessionId}` : `run token ${spawnToken}`;
    warn(
      `[automation] abortSpawnedRun(${who}): termination not confirmed — ${result.outcome}` +
        (result.pid !== undefined ? `, process ${result.pid}` : ""),
    );
    deps.recordReclaimFailure();
    return false;
  };
}
