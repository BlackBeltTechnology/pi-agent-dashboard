/**
 * Pure quiescence / reap-decision core for the embed-session-lifecycle reaper.
 *
 * `decideReap` is a side-effect-free function of a signal snapshot + thresholds
 * + `now`. It encodes the three-gear policy (D2, D4) and every veto so the
 * reaper (Section 4) is a thin loop that assembles signals, calls this, and
 * acts on the verdict. Being pure, it is trivially unit-testable (the X4
 * one-signal-veto matrix, the E12 BVA boundary, the E15 phantom decision-table,
 * the F1/F2 stop-after-turn guard) with no server instance.
 *
 * Design invariants:
 *  - "At rest" is derived from the captured `agent_settled` timestamps, NOT an
 *    inferred `status` (D3): a run is at rest only when a terminal settle is the
 *    latest run signal.
 *  - Idle reaping (gear 1) requires FULL quiescence — every busy signal clear —
 *    because a runtime kill is lossless ONLY for a session with nothing in
 *    flight (D2).
 *  - A subscribed browser and the post-spawn/resume grace window veto ALL gears
 *    (X4 watcher, D12 grace).
 *  - Phantom (gear 3) additionally requires no pending ask + empty queues (X5)
 *    so a session merely blocked on human input is never force-reaped.
 *
 * See OpenSpec change: add-embed-session-lifecycle.
 */
import { isEphemeral } from "./session-lifecycle-policy.js";

/** The reason a session was reaped, surfaced in diagnostics (E20/E21). */
export type ReapReason = "idle" | "stop-after-turn" | "phantom";

/** The injectable per-session snapshot the reaper assembles from live deps. */
export interface LifecycleSignals {
  /** Absent ⇒ durable; only ephemeral sessions are governed. */
  lifecyclePolicy?: "ephemeral" | "durable";
  /** Epoch ms of the latest captured `agent_settled` (terminal at-rest mark). */
  lastSettledAt?: number;
  /** Epoch ms of the latest `agent_start`; newer than `lastSettledAt` ⇒ mid-run. */
  lastRunStartedAt?: number;
  /** Non-null while a tool is executing. */
  currentTool?: string | null;
  /** An unanswered `ask_user` is tracked for the session. */
  hasPendingAsk: boolean;
  /** Queued follow-up prompts (mirror of pi's in-memory queue). */
  followUpCount: number;
  /** Queued steering messages. */
  steeringCount: number;
  /** The session's pi process tree has a live child (from the liveness probe). */
  hasLiveChild: boolean;
  /** A live terminal PTY shares the session's cwd. */
  hasTerminalInCwd: boolean;
  /** A browser is currently subscribed to the session. */
  hasSubscriber: boolean;
  /** Epoch ms when the session was spawned or last resumed (grace anchor). */
  activatedAt: number;
  /** Epoch ms of the most recent activity event. */
  lastActivityAt?: number;
  /** Near-zero CPU across the pi tree (phantom liveness signal). */
  cpuIdle: boolean;
}

export interface LifecycleThresholds {
  /** Idle reap fires when `now - lastActivityAt` exceeds this. */
  idleTimeoutMs: number;
  /** Freshly spawned/resumed sessions are exempt for this long. */
  graceWindowMs: number;
  /** Phantom force-reap fires when a run streams longer than this without settling. */
  hardCeilingMs: number;
}

export type ReapVerdict =
  | { action: "reap"; reason: ReapReason }
  | { action: "skip"; reason: string };

const skip = (reason: string): ReapVerdict => ({ action: "skip", reason });
const reap = (reason: ReapReason): ReapVerdict => ({ action: "reap", reason });

/**
 * A run is "at rest" when a terminal `agent_settled` is the latest run signal.
 * A session that has never started a run is at rest by definition (nothing in
 * flight); a run that started without a later settle is mid-run.
 */
export function isAtRest(s: Pick<LifecycleSignals, "lastSettledAt" | "lastRunStartedAt">): boolean {
  if (s.lastRunStartedAt === undefined) return true;
  if (s.lastSettledAt === undefined) return false;
  return s.lastSettledAt >= s.lastRunStartedAt;
}

/** Post-spawn/resume grace window — exempts a session before it settles (D12). */
export function isWithinGraceWindow(
  s: Pick<LifecycleSignals, "activatedAt">,
  t: Pick<LifecycleThresholds, "graceWindowMs">,
  now: number,
): boolean {
  return now - s.activatedAt < t.graceWindowMs;
}

/** Age since the last activity event; `Infinity` when never observed. */
function idleAge(s: LifecycleSignals, now: number): number {
  return s.lastActivityAt === undefined ? Number.POSITIVE_INFINITY : now - s.lastActivityAt;
}

/** True when the queues are empty AND no ask is pending (gear-2/3 precondition). */
function queuesDrainedAndUnblocked(s: LifecycleSignals): boolean {
  return !s.hasPendingAsk && s.followUpCount === 0 && s.steeringCount === 0;
}

/** Gear 1: idle reap of an at-rest session — requires FULL quiescence. */
function idleGearVerdict(s: LifecycleSignals, t: LifecycleThresholds, now: number): ReapVerdict {
  if (s.currentTool != null) return skip("current-tool");
  if (s.hasPendingAsk) return skip("pending-ask");
  if (s.followUpCount > 0) return skip("followup-queued");
  if (s.steeringCount > 0) return skip("steering-queued");
  if (s.hasTerminalInCwd) return skip("terminal-in-cwd");
  if (s.hasLiveChild) return skip("live-child");
  if (idleAge(s, now) <= t.idleTimeoutMs) return skip("not-idle-yet");
  return reap("idle");
}

/** Gears 2 & 3: a streaming / mid-run session (the at-rest gate failed). */
function streamingGearVerdict(
  s: LifecycleSignals,
  t: LifecycleThresholds,
  now: number,
): ReapVerdict {
  // A live child means genuine work — never touch it.
  if (s.hasLiveChild) return skip("live-child");

  const streamAge = now - (s.lastRunStartedAt ?? s.activatedAt);

  // Gear 3: phantom force-reap — wedged past the hard ceiling. Pending-ask +
  // empty-queue guards are mandatory (X5): a session blocked on human input or
  // holding queued work is NEVER force-reaped.
  if (streamAge > t.hardCeilingMs && s.cpuIdle && queuesDrainedAndUnblocked(s)) {
    return reap("phantom");
  }

  // Gear 2: graceful stop-after-turn — idle-trending, drains queues first (F2).
  if (idleAge(s, now) > t.idleTimeoutMs && queuesDrainedAndUnblocked(s)) {
    return reap("stop-after-turn");
  }

  return skip("streaming-active");
}

/**
 * Decide whether — and how — to reap a session. Pure; the caller applies the
 * verdict (gear 1 → `killBySessionId`, gear 2 → `stop_after_turn`, gear 3 →
 * graceful phantom kill). Order: universal vetoes first, then the at-rest idle
 * gear, then the streaming phantom/stop gears.
 */
export function decideReap(
  s: LifecycleSignals,
  t: LifecycleThresholds,
  now: number,
): ReapVerdict {
  if (!isEphemeral(s)) return skip("not-ephemeral"); // durable never governed
  if (s.hasSubscriber) return skip("active-watcher"); // universal veto
  if (isWithinGraceWindow(s, t, now)) return skip("grace-window"); // universal veto
  return isAtRest(s) ? idleGearVerdict(s, t, now) : streamingGearVerdict(s, t, now);
}
