/**
 * EmptyActionableGuard — decides continue-or-surface for empty-actionable
 * assistant turns, with a bounded consecutive-continuation cap so a model that
 * keeps emitting reasoning-only turns cannot spin forever.
 *
 * The guard is fed the actionability of EVERY terminal turn (via `observe`) so
 * it can reset its per-session counter when a normal / tool-call / truncated /
 * error turn arrives. Only `empty-actionable` turns yield a `continue` or
 * `surface` action; everything else yields `none` and clears the counter.
 *
 * Modes:
 *  - `auto-continue`  — nudge the model up to `retryCap` consecutive times;
 *                       on cap-exceeded fall back to `surface`.
 *  - `surface-only`   — never nudge; always `surface` on empty-actionable.
 *
 * Pure and side-effect free (mutates only its own per-session counter). The
 * bridge owns the actual continuation channel (`enqueueSystemFollowup`) and the
 * surface event send.
 *
 * See change: fix-gemini-subagent-silent-tool-schema-failure.
 */

import type { TurnActionability } from "./turn-actionability.js";

export type GuardMode = "auto-continue" | "surface-only";

export type GuardAction = "continue" | "surface" | "none";

export interface GuardDecision {
  action: GuardAction;
  /** The continuation nudge text — present only when `action === "continue"`. */
  nudge?: string;
  /** Human-readable reason — present when `action === "surface"`. */
  reason?: string;
}

/**
 * Minimal continuation nudge. Kept terse and directive so the model emits its
 * pending answer/action rather than more reasoning. The model was mid-plan when
 * it stopped, so a light prompt is enough.
 */
export const CONTINUATION_NUDGE =
  "Continue: emit your answer or next action now. Do not respond with reasoning only.";

/** Surface message shown on the card + written to server.log. NON-error. */
export const SURFACE_MESSAGE = "model returned only reasoning, no answer";

export const DEFAULT_RETRY_CAP = 2;

export class EmptyActionableGuard {
  /** sessionId → consecutive empty-actionable continuation count. */
  private count = new Map<string, number>();

  constructor(
    private readonly mode: GuardMode = "auto-continue",
    private readonly retryCap: number = DEFAULT_RETRY_CAP,
  ) {}

  /**
   * Observe a terminal turn's classification for a session and decide.
   * Non-empty-actionable classifications reset the counter and return `none`.
   */
  observe(sessionId: string, actionability: TurnActionability): GuardDecision {
    if (actionability !== "empty-actionable") {
      this.count.delete(sessionId);
      return { action: "none" };
    }

    if (this.mode === "surface-only") {
      return { action: "surface", reason: SURFACE_MESSAGE };
    }

    // auto-continue
    const soFar = this.count.get(sessionId) ?? 0;
    if (soFar < this.retryCap) {
      this.count.set(sessionId, soFar + 1);
      return { action: "continue", nudge: CONTINUATION_NUDGE };
    }

    // Cap exceeded — stop nudging, fall back to surface, reset so a later
    // fresh chain starts clean.
    this.count.delete(sessionId);
    return { action: "surface", reason: SURFACE_MESSAGE };
  }

  /** Explicitly clear a session's counter (e.g. on session end / new user turn). */
  reset(sessionId: string): void {
    this.count.delete(sessionId);
  }
}
