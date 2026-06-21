/**
 * Run lifecycle orchestrator: concurrency policy + status tracking.
 *
 * `fire(automation)` is invoked by the scheduler when a trigger fires. The
 * runner enforces the automation's `concurrency` policy against the active
 * run for that automation key:
 *   - skip (default): drop the fire, log it.
 *   - queue:          enqueue; start when the active run ends.
 *   - parallel:       start immediately alongside.
 *
 * Starting a run delegates to an injected `startRun` (which resolves the
 * model, writes the `running` run record, and spawns the session via the
 * `ServerPluginContext` spawn hook). When a run ends, the host calls
 * `completeRun(key, runId, outcome)` to write `result.md` + drain the queue.
 *
 * Keeping the policy/state machine separate from the I/O makes it fully
 * unit-testable. See change: add-automation-plugin.
 */
import type { DiscoveredAutomation } from "../shared/automation-types.js";
import { automationKey } from "./scheduler.js";

export interface StartedRun {
  runId: string;
}

export interface RunnerDeps {
  /**
   * Start a run: resolve model, write the `running` record, spawn the
   * session. Returns the started run id, or null when the start failed
   * (e.g. spawn error). The runner treats a null as "not active".
   */
  startRun: (automation: DiscoveredAutomation) => StartedRun | null;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
}

interface ActiveState {
  runId: string;
  /** FIFO of automations waiting on this key (concurrency: queue). */
  queue: DiscoveredAutomation[];
}

export interface Runner {
  /** Scheduler fire entrypoint. Applies the concurrency policy. */
  fire(automation: DiscoveredAutomation): void;
  /** Mark a run finished; drains a queued fire (if any). */
  completeRun(key: string): void;
  /** Currently-active run id for a key, or null. */
  activeRunId(key: string): string | null;
  /** Pending-queue length for a key. */
  queuedCount(key: string): number;
}

export function createRunner(deps: RunnerDeps): Runner {
  const log = deps.log ?? (() => {});
  const warn = deps.warn ?? (() => {});
  const active = new Map<string, ActiveState>();

  function begin(automation: DiscoveredAutomation): void {
    const key = automationKey(automation);
    const started = deps.startRun(automation);
    if (!started) {
      warn(`[runner] startRun failed for ${key}`);
      return;
    }
    active.set(key, { runId: started.runId, queue: active.get(key)?.queue ?? [] });
  }

  return {
    fire(automation: DiscoveredAutomation): void {
      const key = automationKey(automation);
      const state = active.get(key);
      const policy = automation.config?.concurrency ?? "skip";

      if (!state) {
        begin(automation);
        return;
      }

      // A run is already active for this key.
      switch (policy) {
        case "skip":
          log(`[runner] skip: drop overlapping fire for ${key} (active run ${state.runId})`);
          return;
        case "queue":
          state.queue.push(automation);
          log(`[runner] queue: deferred fire for ${key} (depth ${state.queue.length})`);
          return;
        case "parallel":
          // Parallel runs share the key but we only track the latest as
          // "active" for queue-drain purposes; both still run.
          begin(automation);
          return;
      }
    },

    completeRun(key: string): void {
      const state = active.get(key);
      if (!state) return;
      const next = state.queue.shift();
      if (next) {
        // Replace active with the dequeued run.
        active.delete(key);
        begin(next);
        // Preserve any further queued items onto the new active state.
        const newState = active.get(key);
        if (newState) newState.queue = state.queue;
      } else {
        active.delete(key);
      }
    },

    activeRunId(key: string): string | null {
      return active.get(key)?.runId ?? null;
    },

    queuedCount(key: string): number {
      return active.get(key)?.queue.length ?? 0;
    },
  };
}
