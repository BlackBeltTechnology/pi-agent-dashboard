/**
 * Adaptive async scheduler for the child-process scan (change:
 * optimize-polling-hot-paths). Pure: clock and timers are injected.
 *
 * - Cadence: FAST (5 s Unix / 10 s Windows) while the agent runs or a tool
 *   executes, for 15 s after either ends, and for 30 s after the process list
 *   changed; IDLE (30 s Unix / 60 s Windows) otherwise.
 * - An idle→fast transition re-arms the pending timer when it is further away
 *   than the fast delay, so a backgrounded process shows up within one fast tick.
 * - One extra scan 1 s after a `bash` tool ends (case-insensitive).
 * - A scan never overlaps another: a due timer while a scan is in flight is
 *   skipped; the settling scan re-arms.
 * - `dispose()` clears every timer and ignores late settles.
 */

interface ScanOutcome {
  /** True when the visible process list differs from the previous scan. */
  changed: boolean;
}

type Timer = ReturnType<typeof setTimeout>;

export interface ProcessScanSchedulerDeps {
  /** Run one scan (never rejects). */
  scan: () => Promise<ScanOutcome | void>;
  platform?: string;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (t: Timer) => void;
}

export interface ProcessScanScheduler {
  start(): void;
  onAgentStart(): void;
  onAgentEnd(): void;
  onToolStart(): void;
  onToolEnd(toolName?: string): void;
  dispose(): void;
}

const AFTER_ACTIVITY_MS = 15_000;
const AFTER_CHANGE_MS = 30_000;
const POST_BASH_MS = 1_000;

export function createProcessScanScheduler(deps: ProcessScanSchedulerDeps): ProcessScanScheduler {
  const win = (deps.platform ?? process.platform) === "win32";
  const FAST = win ? 10_000 : 5_000;
  const IDLE = win ? 60_000 : 30_000;
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t));

  let disposed = false;
  let started = false;
  let running = false;
  let agentRunning = false;
  let toolsRunning = 0;
  let fastUntil = Number.NEGATIVE_INFINITY;
  let timer: Timer | undefined;
  let timerDue = Number.POSITIVE_INFINITY;
  const oneShots = new Set<Timer>();

  const isFast = () => agentRunning || toolsRunning > 0 || now() < fastUntil;

  function armAt(delay: number): void {
    if (disposed || !started) return;
    const due = now() + delay;
    if (timer && timerDue <= due) return;
    if (timer) clearTimer(timer);
    timerDue = due;
    timer = setTimer(() => {
      timer = undefined;
      timerDue = Number.POSITIVE_INFINITY;
      void run();
    }, delay);
  }

  async function run(): Promise<void> {
    if (disposed || running) return; // overlap skip; the in-flight scan re-arms on settle
    running = true;
    try {
      const out = await deps.scan();
      if (out?.changed) fastUntil = Math.max(fastUntil, now() + AFTER_CHANGE_MS);
    } catch {
      /* scan never rejects; defensive */
    } finally {
      running = false;
      if (!disposed) armAt(isFast() ? FAST : IDLE);
    }
  }

  const bump = () => {
    if (isFast()) armAt(FAST);
  };

  return {
    start() {
      if (started || disposed) return;
      started = true;
      armAt(FAST);
    },
    onAgentStart() {
      agentRunning = true;
      bump();
    },
    onAgentEnd() {
      agentRunning = false;
      fastUntil = Math.max(fastUntil, now() + AFTER_ACTIVITY_MS);
    },
    onToolStart() {
      toolsRunning += 1;
      bump();
    },
    onToolEnd(toolName) {
      toolsRunning = Math.max(0, toolsRunning - 1);
      fastUntil = Math.max(fastUntil, now() + AFTER_ACTIVITY_MS);
      if (toolName && toolName.toLowerCase() === "bash" && !disposed) {
        const t = setTimer(() => {
          oneShots.delete(t);
          void run();
        }, POST_BASH_MS);
        oneShots.add(t);
      }
    },
    dispose() {
      disposed = true;
      if (timer) clearTimer(timer);
      timer = undefined;
      for (const t of oneShots) clearTimer(t);
      oneShots.clear();
    },
  };
}
