/**
 * Thin, individually testable seams between `bridge.ts` and the poll-cost
 * machinery (change: optimize-polling-hot-paths). `bridge.ts` opens a socket,
 * mDNS and timers at load, so nothing here may import it; the bridge calls
 * these, and `bridge-polling.test.ts` drives the real functions.
 */
import type { GitTracker } from "./git-tracker.js";
import { handleGitInfoRefresh, type PrStatusScheduler } from "./pr-status.js";
import type { ProcessScanScheduler } from "./process-scan-scheduler.js";

/** Delay that lets pi's `ctx.model` reflect a new model before it is read (same as `setModel`). */
const MODEL_SELECT_RECHECK_MS = 50;

/** Run and clear every registered disposable; one throwing never blocks the rest. */
export function drainDisposables(state: { disposables?: Array<() => void> }): void {
  const list = state.disposables;
  state.disposables = [];
  if (!list) return;
  for (const dispose of list) {
    try {
      dispose();
    } catch {
      /* best-effort teardown */
    }
  }
}

/**
 * Feed the forwarded pi lifecycle events to the adaptive process-scan cadence
 * and to the git tracker (a non-read-only tool end requests a slow-lane probe).
 */
export function feedPollingEvent(
  eventType: string,
  event: { toolName?: string } | undefined,
  deps: { processScan?: ProcessScanScheduler | null; gitTracker?: Pick<GitTracker, "onToolEnd"> | null },
): void {
  switch (eventType) {
    case "agent_start":
      deps.processScan?.onAgentStart();
      break;
    case "agent_end":
      deps.processScan?.onAgentEnd();
      break;
    case "tool_execution_start":
      deps.processScan?.onToolStart();
      break;
    case "tool_execution_end":
      deps.processScan?.onToolEnd(event?.toolName);
      deps.gitTracker?.onToolEnd(event?.toolName);
      break;
  }
}

/**
 * `git_info_refresh`: EVERY refresh invalidates the static facts and requests a
 * fast probe; the PR scheduler keeps its own reason handling (unknown reasons
 * are ignored there). Returns `true` when the message was consumed.
 */
export function routeGitInfoRefresh(
  msg: { type?: unknown; reason?: unknown },
  deps: { prStatus: Pick<PrStatusScheduler, "refresh">; gitTracker?: Pick<GitTracker, "refresh"> | null },
): boolean {
  if (msg.type !== "git_info_refresh") return false;
  deps.gitTracker?.refresh();
  return handleGitInfoRefresh(msg, deps.prStatus);
}

/** `model_select`: re-check the model after pi's ctx has settled. */
export function scheduleModelRecheckOnSelect(
  setTimer: (fn: () => void, ms: number) => unknown,
  recheck: () => void,
): void {
  setTimer(recheck, MODEL_SELECT_RECHECK_MS);
}
