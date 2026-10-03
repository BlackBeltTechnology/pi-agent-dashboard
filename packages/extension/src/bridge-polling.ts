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

/** Owns the per-incarnation scan scheduler and git tracker so replacing one disposes the previous. */
export interface PollingHolder {
  readonly processScan: ProcessScanScheduler | null;
  readonly gitTracker: GitTracker | null;
  /** Dispose the previous scan scheduler (schedules never stack) and hold `next`. */
  replaceProcessScan(next: ProcessScanScheduler): void;
  /** Dispose the previous tracker and hold `next`; returns it. */
  replaceGitTracker(next: GitTracker): GitTracker;
  /** Dispose and forget both (registered once as a bridge disposable). */
  disposeAll(): void;
}

export function createPollingHolder(): PollingHolder {
  let processScan: ProcessScanScheduler | null = null;
  let gitTracker: GitTracker | null = null;
  return {
    get processScan() {
      return processScan;
    },
    get gitTracker() {
      return gitTracker;
    },
    replaceProcessScan(next) {
      processScan?.dispose();
      processScan = next;
    },
    replaceGitTracker(next) {
      gitTracker?.dispose();
      gitTracker = next;
      return next;
    },
    disposeAll() {
      processScan?.dispose();
      processScan = null;
      gitTracker?.dispose();
      gitTracker = null;
    },
  };
}

/** The slice of `BridgeState` the re-init teardown touches. */
export interface PreviousIncarnation {
  cleanup?: () => void;
  connections?: Array<{ disconnect(): void }>;
  timers?: Array<ReturnType<typeof setInterval>>;
  disposables?: Array<() => void>;
}

/**
 * Tear down what a previous bridge incarnation left behind (`/reload`, session
 * replacement). Returns `false` — touching NOTHING — on a subagent re-entry, so
 * a subagent loading the bridge in the parent's process never disposes the
 * parent's schedulers, watchers or timers.
 */
export function teardownPreviousIncarnation(prev: PreviousIncarnation, isReentry: () => boolean): boolean {
  if (isReentry()) return false;
  prev.cleanup?.();
  prev.cleanup = undefined;
  // Disconnect ALL orphaned connections from previous bridge incarnations
  for (const conn of prev.connections ?? []) conn.disconnect();
  prev.connections = [];
  // Clear ALL orphaned timers (clearInterval also clears timeouts)
  for (const t of prev.timers ?? []) clearInterval(t);
  prev.timers = [];
  drainDisposables(prev);
  return true;
}
