/**
 * Server-side canvas accumulator (change: auto-canvas, Decision 2).
 *
 * The pure classifier + normalizer live in `packages/shared`
 * (`detectCanvasIntent`, `selectCanvasTarget`, `normalizeCanvasDeclare`).
 * This module owns the *stateful* half the shared boundary intentionally
 * omits: a per-session per-turn candidate buffer plus the eager/settle/reset
 * lifecycle, wired to injected broadcast + settings-read functions so the
 * whole thing unit-tests without a live server (S9–S12, S21).
 *
 * Guards mirror `detectOpenSpecActivity`'s call site: replayed events and
 * `queue_state` never accumulate (else a forked session's replayed writes
 * auto-open the live canvas — S9, S12).
 *
 * Turn boundaries:
 *   - `agent_end`  → settle (`selectCanvasTarget` over the buffer) then reset.
 *   - turn start / abort / termination → reset with NO settle (S11): an
 *     aborted turn's candidates must not leak into a later write-less turn.
 *
 * See change: auto-canvas.
 */

import {
  type CanvasDeclareInput,
  type CanvasMode,
  normalizeCanvasDeclare,
} from "@blackbelt-technology/pi-dashboard-shared/canvas-declare.js";
import {
  type CanvasCandidate,
  detectCanvasIntent,
  selectCanvasTarget,
} from "@blackbelt-technology/pi-dashboard-shared/canvas-detect.js";
import type { CanvasTypes } from "@blackbelt-technology/pi-dashboard-shared/canvas-types.js";
import type { ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** Minimal forwarded-event shape the accumulator reads. */
export interface CanvasForwardedEvent {
  eventType: string;
  data?: { toolName?: unknown; args?: unknown };
}

export interface CanvasAccumulatorDeps {
  /**
   * Fresh effective `canvasTypes` for the session cwd, read on EVERY detect —
   * NO cache (S21). Absent settings → all-on default.
   */
  readCanvasTypes: (cwd: string) => CanvasTypes;
  /** Broadcast a `canvas_intent` (eager mid-turn or settle at turn end). */
  broadcastIntent: (
    sessionId: string,
    phase: "eager" | "settle",
    target: ViewTarget | null,
    mode?: "replace" | "pin",
    title?: string,
  ) => void;
  /** Broadcast a `canvas_server_chip` for a declared server (Decision 4). */
  broadcastServerChip: (sessionId: string, port: number, title?: string) => void;
  /**
   * Broadcast a chip-expiry for a session's active server chip (S32): at the
   * turn boundary (`agent_end`) or abort/termination the chip must become
   * non-actionable. `port` echoes the expired chip.
   */
  broadcastServerChipExpire: (sessionId: string, port: number) => void;
}

export interface CanvasAccumulator {
  /**
   * Handle one forwarded event. `replaying` and the `queue_state` type are
   * both no-ops (guard mirror). `cwd` is the session cwd from server state.
   */
  onEvent: (
    sessionId: string,
    event: CanvasForwardedEvent,
    ctx: { replaying: boolean; cwd: string },
  ) => void;
  /** Reset a session's buffer with no settle (abort / termination). */
  resetTurn: (sessionId: string) => void;
}

/** Map a declare `mode` onto the two-state lifecycle the intent message carries. */
function intentMode(mode: CanvasMode | undefined): "replace" | "pin" {
  return mode === "pin" ? "pin" : "replace";
}

export function createCanvasAccumulator(
  deps: CanvasAccumulatorDeps,
): CanvasAccumulator {
  // Per-session per-turn candidate buffer.
  const buffers = new Map<string, CanvasCandidate[]>();
  // Per-session active server-chip port (declared this turn), for expiry (S32).
  const activeChips = new Map<string, number>();

  function expireChip(sessionId: string): void {
    const port = activeChips.get(sessionId);
    if (port === undefined) return;
    activeChips.delete(sessionId);
    deps.broadcastServerChipExpire(sessionId, port);
  }

  function pushCandidate(
    sessionId: string,
    candidate: CanvasCandidate,
    mode?: "replace" | "pin",
    title?: string,
  ): void {
    const buf = buffers.get(sessionId) ?? [];
    const wasEmpty = buf.length === 0;
    buf.push(candidate);
    buffers.set(sessionId, buf);
    // Eager (S26): fire on the FIRST candidate of the turn; every subsequent
    // DECLARE re-crowns the eager target (S16). Non-first DOC candidates only
    // accumulate — recency is resolved at settle.
    if (wasEmpty || candidate.prio === "DECLARE") {
      deps.broadcastIntent(sessionId, "eager", candidate.target, mode, title);
    }
  }

  function onToolStart(sessionId: string, event: CanvasForwardedEvent, cwd: string): void {
    const toolName = typeof event.data?.toolName === "string" ? event.data.toolName : "";
    if (!toolName) return;
    const args = event.data?.args as Record<string, unknown> | undefined;

    // `canvas()` declare-tool: normalized here with the session cwd; bypasses
    // the type registry (Decision 5/6). Server target → chip path (Decision 4);
    // NO probe/fetch (S29). A bad shape is ignored (the bridge already returned
    // the error ack).
    if (toolName.toLowerCase() === "canvas") {
      // `normalizeCanvasDeclare` re-validates the raw shape (cwd-free) before
      // trusting any field, so an untyped args object is safe to pass.
      const result = normalizeCanvasDeclare(args as CanvasDeclareInput | undefined, cwd);
      if (!result.ok) return;
      if ("chip" in result) {
        activeChips.set(sessionId, result.chip.port);
        deps.broadcastServerChip(sessionId, result.chip.port, result.chip.title);
        return;
      }
      pushCandidate(sessionId, result.candidate, intentMode(result.mode), result.title);
      return;
    }

    // DOC detect: write/edit only, gated by the fresh-read type registry.
    const canvasTypes = deps.readCanvasTypes(cwd);
    const candidate = detectCanvasIntent(toolName, args, cwd, canvasTypes);
    if (candidate) pushCandidate(sessionId, candidate);
  }

  function onAgentEnd(sessionId: string): void {
    const buf = buffers.get(sessionId);
    buffers.delete(sessionId);
    // NOTE: a server chip declared THIS turn stays actionable through its own
    // `agent_end` (the human taps it after the turn settles) — it expires only
    // at the NEXT turn boundary (`agent_start` → resetTurn) or on abort/exit.
    // No canvas activity this turn → nothing to settle (avoids closing a prior
    // session-persisted canvas and avoids per-idle-turn spam).
    if (!buf || buf.length === 0) return;
    deps.broadcastIntent(sessionId, "settle", selectCanvasTarget(buf));
  }

  function resetTurn(sessionId: string): void {
    buffers.delete(sessionId);
    // The NEXT turn boundary (agent_start) and abort/termination expire the
    // prior turn's chip (S32).
    expireChip(sessionId);
  }

  return {
    onEvent(sessionId, event, ctx) {
      // Guard mirror: replayed events and queue_state never accumulate.
      if (ctx.replaying) return;
      if (event.eventType === "queue_state") return;
      if (event.eventType === "tool_execution_start") {
        onToolStart(sessionId, event, ctx.cwd);
      } else if (event.eventType === "agent_end") {
        onAgentEnd(sessionId);
      } else if (event.eventType === "agent_start") {
        // Turn-start boundary: clear any candidates a prior un-settled
        // (aborted) turn left behind, before this turn accumulates (S11).
        resetTurn(sessionId);
      }
    },
    resetTurn,
  };
}
