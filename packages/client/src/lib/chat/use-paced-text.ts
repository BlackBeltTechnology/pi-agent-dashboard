/**
 * `usePacedText` — frame-driven paced reveal of streamed text (design D3).
 *
 * Streamed text arrives in bursts (the bridge coalesces to 50 ms windows and
 * providers stall then dump whole paragraphs). This hook returns a prefix of
 * `target` that grows on animation frames at a rate adapting to the backlog, so
 * the same feed reads as continuous.
 *
 * Contract (each rule has a fake-timer unit test):
 *  - step per frame `n = max(BASE_CPS·dt, backlog·(1 − e^(−dt/τ)))`, fraction
 *    carried over, extended to the next whitespace (cosmetic, ≤ 48 chars);
 *  - DEADLINE: received deltas are queued as `(endOffset, arrivedAt)`; entries
 *    older than 400 ms are compacted into one `mustShow` offset and every step
 *    raises shown to ≥ `mustShow`; a `setTimeout` armed for the oldest entry's
 *    deadline forces a step even when rAF is throttled while "visible". This —
 *    not the exponential term, which is asymptotic — bounds the lag: every
 *    received character is visible within 500 ms;
 *  - snap to `target` when backlog > 4000 or shown is not a prefix of `target`;
 *  - whenever `active` is false the hook returns `target` and syncs (shown =
 *    target, queue cleared), so re-activation never re-hides seen text; a target
 *    that shrinks/resets clears the queue and syncs too;
 *  - `frozen` (read from the synchronous selection clock) takes precedence over
 *    snap, sync and a hidden document: while frozen nothing advances;
 *  - rAF is scheduled only while backlog > 0.
 *
 * With `active` false the hook is a pass-through, so motion off costs today's
 * render exactly.
 *
 * See change: add-fluid-chat-motion.
 */
import { useEffect, useLayoutEffect, useReducer, useRef } from "react";

const PACE_BASE_CPS = 90;
const PACE_TAU_MS = 120;
export const PACE_DEADLINE_MS = 400;
export const PACE_SNAP_BACKLOG = 4000;
const PACE_MAX_WORD_EXTEND = 48;
/** Longest frame delta counted (a backgrounded tab resuming must not teleport). */
const MAX_DT_MS = 100;
/** Design D4 escalation step 1: minimum ms between reveal steps (0 = every frame). Each step is one render. */
const PACE_MIN_STEP_MS = 33;

export interface PacedTextOptions {
  /** Motion on ∧ document visible ∧ following ∧ (reasoning: inline-flow ∧ expanded). */
  active: boolean;
  /** Frozen state (a held selection). Re-evaluated on change to resume the reveal. */
  frozen?: boolean;
  /** Synchronous selection clock, read inside every step so no step runs after a drag starts. */
  isFrozen?: () => boolean;
}

interface QueueEntry {
  end: number;
  at: number;
}

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

function extendToWhitespace(target: string, from: number): number {
  if (from >= target.length) return target.length;
  const limit = Math.min(target.length, from + PACE_MAX_WORD_EXTEND);
  for (let i = from; i < limit; i += 1) {
    if (/\s/.test(target[i])) return i;
  }
  return from;
}

export function usePacedText(target: string, options: PacedTextOptions): string {
  const { active, frozen = false, isFrozen } = options;
  const [, tick] = useReducer((x: number) => x + 1, 0);

  const shownRef = useRef(target.length);
  const queueRef = useRef<QueueEntry[]>([]);
  const mustShowRef = useRef(0);
  const carryRef = useRef(0);
  const lastFrameRef = useRef(0);
  const lastTargetRef = useRef(target);
  const targetRef = useRef(target);
  const activeRef = useRef(active);
  const frozenPropRef = useRef(frozen);
  const isFrozenRef = useRef(isFrozen);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  activeRef.current = active;
  frozenPropRef.current = frozen;
  isFrozenRef.current = isFrozen;

  const frozenNow = (): boolean => frozenPropRef.current || (isFrozenRef.current?.() ?? false);

  // ── Render: derive what to show from the refs (idempotent ref writes only) ──
  const frozenAtRender = frozen || (isFrozen?.() ?? false);
  const clampedShown = Math.min(shownRef.current, target.length);
  const prefixOk = clampedShown === 0 || target.startsWith(lastTargetRef.current.slice(0, clampedShown));
  if (target.length < shownRef.current) {
    // Shrink / reset (new turn): clear and sync, even when frozen — the old text is gone.
    shownRef.current = target.length;
    queueRef.current = [];
    mustShowRef.current = 0;
  } else if (!active && !frozenAtRender) {
    shownRef.current = target.length;
    queueRef.current = [];
    mustShowRef.current = 0;
  } else if (!frozenAtRender && (!prefixOk || target.length - shownRef.current > PACE_SNAP_BACKLOG)) {
    // Snap: shown is no longer a prefix of target, or the backlog is too deep to pace.
    shownRef.current = target.length;
    queueRef.current = [];
    mustShowRef.current = 0;
  }
  const shown = Math.min(shownRef.current, target.length);
  const output = shown >= target.length ? target : target.slice(0, shown);

  // ── Scheduling ────────────────────────────────────────────────────────────
  const cancelAll = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  /** Compact entries past the deadline into `mustShow`; returns the new minimum shown. */
  const applyDeadline = (t: number) => {
    const q = queueRef.current;
    while (q.length > 0 && t - q[0].at >= PACE_DEADLINE_MS) {
      mustShowRef.current = Math.max(mustShowRef.current, q[0].end);
      q.shift();
    }
  };

  const commitShown = (next: number) => {
    const len = targetRef.current.length;
    const clamped = Math.min(Math.max(next, shownRef.current), len);
    if (clamped === shownRef.current) return;
    shownRef.current = clamped;
    const q = queueRef.current;
    while (q.length > 0 && q[0].end <= clamped) q.shift();
    if (mustShowRef.current <= clamped) mustShowRef.current = 0;
    tick();
  };

  const scheduleRef = useRef<() => void>(() => {});
  scheduleRef.current = () => {
    if (!activeRef.current || frozenNow() || shownRef.current >= targetRef.current.length) {
      // The loop is stopping: the next reveal must not inherit a stale frame delta.
      lastFrameRef.current = 0;
      return;
    }
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(frame);
    }
    // Backstop for a throttled rAF: force a step at the oldest entry's deadline.
    if (timerRef.current === null && queueRef.current.length > 0) {
      const delay = Math.max(0, queueRef.current[0].at + PACE_DEADLINE_MS - now());
      timerRef.current = setTimeout(forceDeadline, delay);
    }
  };

  function forceDeadline() {
    timerRef.current = null;
    if (!activeRef.current || frozenNow()) return;
    const t = now();
    applyDeadline(t);
    commitShown(mustShowRef.current);
    scheduleRef.current();
  }

  function frame() {
    rafRef.current = null;
    if (!activeRef.current || frozenNow()) return;
    const t = now();
    if (PACE_MIN_STEP_MS > 0 && t - lastFrameRef.current < PACE_MIN_STEP_MS && lastFrameRef.current !== 0) {
      scheduleRef.current();
      return;
    }
    const dt = lastFrameRef.current === 0 ? 16 : Math.min(t - lastFrameRef.current, MAX_DT_MS);
    lastFrameRef.current = t;
    const full = targetRef.current;
    const shownNow = shownRef.current;
    const backlog = full.length - shownNow;
    if (backlog <= 0) return;
    if (backlog > PACE_SNAP_BACKLOG) {
      queueRef.current = [];
      mustShowRef.current = 0;
      commitShown(full.length);
      return;
    }
    applyDeadline(t);
    const raw = Math.max((PACE_BASE_CPS * dt) / 1000, backlog * (1 - Math.exp(-dt / PACE_TAU_MS))) + carryRef.current;
    const whole = Math.floor(raw);
    carryRef.current = raw - whole;
    let next = shownNow + whole;
    if (next < full.length && whole > 0) next = extendToWhitespace(full, next);
    next = Math.max(next, mustShowRef.current);
    commitShown(next);
    scheduleRef.current();
  }

  // ── After each commit: record arrivals, (re)arm the schedule ───────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs/closures read at commit time
  useLayoutEffect(() => {
    targetRef.current = target;
    const prev = lastTargetRef.current;
    const prevLen = prev.length;
    lastTargetRef.current = target;
    if (!active && !frozenNow()) {
      cancelAll();
      lastFrameRef.current = 0;
      return;
    }
    if (target.length > prevLen && target.startsWith(prev)) {
      const t = now();
      // Compact first, so the queue stays bounded even across a long freeze.
      applyDeadline(t);
      queueRef.current.push({ end: target.length, at: t });
    }
    scheduleRef.current();
  }, [target, active]);

  // Unfreeze: everything older than the deadline appears in the same commit, the rest flows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the frozen edge only
  useLayoutEffect(() => {
    if (frozen || !activeRef.current) return;
    applyDeadline(now());
    commitShown(mustShowRef.current);
    scheduleRef.current();
  }, [frozen]);

  useEffect(() => () => cancelAll(), []);

  return output;
}
