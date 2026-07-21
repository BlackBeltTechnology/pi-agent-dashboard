/**
 * Headless session-state hook for embedding the dashboard chat.
 *
 * `useSessionState` folds a pi-dashboard message stream into the same
 * `SessionState` the app's `useMessageHandler` produces, with NO JSX and NO
 * UI-primitive dependencies. It wraps the already-pure reduction primitives in
 * `../lib/event-reducer` (`createInitialState`, `reduceEvent`) and
 * `../lib/coalesce-live-events` (`foldLiveEvents`) — it adds no new reduction
 * logic, only the driver routing + the `event_replay` sequence-reset decision.
 *
 * The reducer is exposed as a pure function `applySessionMessage(acc, msg)` so
 * it is testable without React; the hook is a thin imperative wrapper.
 *
 * Message-type coverage (session-scoped, SessionState-affecting only):
 *   - `event`              live fold via `foldLiveEvents` (isLive: true)
 *   - `event_replay`       reset-or-append fold via `reduceEvent`
 *   - `prompt_received`    `applyPromptReceived`
 *   - `extension_ui_request` / `prompt_request`   `addInteractiveRequest`
 *   - `ui_dismiss` / `prompt_dismiss` / `prompt_cancel`  `dismissInteractiveRequest`
 *   - `session_state_reset` reset carrying `pendingPrompt`
 * `asset_register` is intentionally a no-op here — it mutates session assets
 * (`SessionAssetsContext`), not `SessionState`.
 *
 * See change: add-embeddable-chat-view.
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { useCallback, useRef, useState } from "react";
import { foldLiveEvents } from "../lib/chat/coalesce-live-events.js";
import {
  addInteractiveRequest,
  applyPromptReceived,
  createInitialState,
  dismissInteractiveRequest,
  foldReplayBuffer,
  reduceEvent,
  type SessionState,
} from "../lib/chat/event-reducer.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * Accumulator threaded through the pure reducer. `maxSeq` is the highest event
 * sequence folded so far; it drives the `event_replay` reset decision (a full
 * re-replay whose `firstSeq <= maxSeq` must reset before folding, mirroring
 * `useMessageHandler`).
 */
export interface SessionStateAccumulator {
  readonly state: SessionState;
  readonly maxSeq: number;
  /**
   * Raw event buffer (ascending by seq), the authoritative fold input for the
   * tail-first `kind: "older"` prepend+refold path. Optional so pre-existing
   * callers that build `{ state, maxSeq }` accumulators keep working (treated
   * as empty). See change: tail-first-session-loading.
   */
  readonly buffer?: ReadonlyArray<{ seq: number; event: DashboardEvent }>;
  /** True between the first and final batches of a `kind: "tail"` window. */
  readonly tailReplayInProgress?: boolean;
}

export function createSessionAccumulator(): SessionStateAccumulator {
  return { state: createInitialState(), maxSeq: 0, buffer: [], tailReplayInProgress: false };
}

/** Return the same accumulator when the folded state is referentially unchanged. */
function settle(acc: SessionStateAccumulator, state: SessionState): SessionStateAccumulator {
  return state === acc.state ? acc : { ...acc, state };
}

/**
 * Fold an `event_replay` batch. Mirrors `useMessageHandler`: computes the
 * reset decision from `maxSeq` BEFORE folding, resets carrying `pendingPrompt`,
 * then folds each event via `reduceEvent` (no isLive) and re-tracks `maxSeq`.
 */
function applyReplay(
  acc: SessionStateAccumulator,
  msg: Extract<ServerToBrowserMessage, { type: "event_replay" }>,
): SessionStateAccumulator {
  const events = msg.events as ReadonlyArray<{ seq: number; event: DashboardEvent }>;

  // kind: "older" — prepend to the raw buffer, refold the whole buffer from
  // scratch (order-dependent reducer forbids mid-stream folds), never touch
  // maxSeq. See change: tail-first-session-loading.
  if (msg.kind === "older") {
    if (events.length === 0) return acc;
    const accBuffer = acc.buffer ?? [];
    const seen = new Set(accBuffer.map((e) => e.seq));
    const older = events.filter((e) => !seen.has(e.seq));
    const merged = [...older, ...accBuffer].sort((a, b) => a.seq - b.seq);
    let state = foldReplayBuffer(merged.map((e) => e.event));
    if (acc.state.pendingPrompt) state = { ...state, pendingPrompt: acc.state.pendingPrompt };
    return { state, maxSeq: acc.maxSeq, buffer: merged, tailReplayInProgress: acc.tailReplayInProgress };
  }

  // Reset decision driven by explicit window metadata (kind), with the legacy
  // firstSeq heuristic as the no-kind fallback.
  const firstSeq = events.length > 0 ? events[0].seq : null;
  let shouldReset: boolean;
  if (msg.kind === "tail") {
    shouldReset = firstSeq != null && !acc.tailReplayInProgress;
  } else if (msg.kind === "delta") {
    shouldReset = false;
  } else {
    shouldReset = firstSeq != null && (firstSeq === 1 || firstSeq <= acc.maxSeq);
  }
  let current = shouldReset ? createInitialState() : acc.state;
  const carry = shouldReset ? acc.state.pendingPrompt : undefined;
  if (carry) current = { ...current, pendingPrompt: carry };
  for (const { event } of events) {
    current = reduceEvent(current, event);
  }
  let maxSeq = shouldReset ? 0 : acc.maxSeq;
  if (events.length > 0) {
    maxSeq = Math.max(maxSeq, events[events.length - 1].seq);
  }
  // Maintain the raw buffer: reset replaces it, delta/continuation appends
  // (dedup by seq).
  const base = shouldReset ? [] : [...(acc.buffer ?? [])];
  const seen = new Set(base.map((e) => e.seq));
  for (const e of events) {
    if (!seen.has(e.seq)) {
      base.push({ seq: e.seq, event: e.event });
      seen.add(e.seq);
    }
  }
  return {
    state: current,
    maxSeq,
    buffer: base,
    tailReplayInProgress: msg.kind === "tail" ? !msg.isLast : false,
  };
}

/**
 * Pure reducer: fold one dashboard message into the accumulator. Returns the
 * SAME accumulator reference for messages that do not affect `SessionState`, so
 * callers can cheaply skip re-renders.
 */
export function applySessionMessage(
  acc: SessionStateAccumulator,
  msg: ServerToBrowserMessage,
): SessionStateAccumulator {
  switch (msg.type) {
    case "event": {
      const { state, maxSeq } = foldLiveEvents(acc.state, [{ seq: msg.seq, event: msg.event }]);
      const accBuffer = acc.buffer ?? [];
      const buffer = accBuffer.some((e) => e.seq === msg.seq)
        ? accBuffer
        : [...accBuffer, { seq: msg.seq, event: msg.event }];
      return { state, maxSeq: Math.max(acc.maxSeq, maxSeq), buffer, tailReplayInProgress: acc.tailReplayInProgress };
    }

    case "event_replay":
      return applyReplay(acc, msg);

    case "session_state_reset": {
      const fresh = createInitialState();
      if (acc.state.pendingPrompt) fresh.pendingPrompt = acc.state.pendingPrompt;
      return { state: fresh, maxSeq: 0, buffer: [], tailReplayInProgress: false };
    }

    case "prompt_received":
      return settle(acc, applyPromptReceived(acc.state, msg.fresh));

    case "extension_ui_request":
      return settle(acc, addInteractiveRequest(acc.state, msg.requestId, msg.method, msg.params));

    case "prompt_request":
      return settle(acc, addPromptBusRequest(acc.state, msg));

    case "ui_dismiss":
      return settle(acc, dismissInteractiveRequest(acc.state, msg.requestId));

    case "prompt_dismiss":
    case "prompt_cancel":
      return settle(acc, dismissInteractiveRequest(acc.state, msg.promptId));

    default:
      return acc;
  }
}

/** Map a PromptBus `prompt_request` message onto `addInteractiveRequest`. */
function addPromptBusRequest(
  state: SessionState,
  msg: Extract<ServerToBrowserMessage, { type: "prompt_request" }>,
): SessionState {
  const toolCallId =
    typeof msg.prompt?.metadata?.toolCallId === "string"
      ? (msg.prompt.metadata.toolCallId as string)
      : undefined;
  return addInteractiveRequest(
    state,
    msg.promptId,
    msg.prompt?.type ?? "select",
    {
      title: msg.prompt?.question,
      message: msg.prompt?.metadata?.message as string | undefined,
      options: msg.prompt?.options,
      defaultValue: msg.prompt?.defaultValue,
      questions: msg.prompt?.metadata?.questions,
      _promptBusComponent: msg.component,
      _promptBusPlacement: msg.placement,
    },
    toolCallId,
  );
}

export interface UseSessionStateResult {
  /** Current reduced session state. */
  state: SessionState;
  /** Fold one dashboard message. Ignores messages for other sessions when a `sessionId` is bound. */
  apply: (msg: ServerToBrowserMessage) => void;
  /** Reset back to the initial empty state. */
  reset: () => void;
}

/**
 * Imperative hook: maintains a `SessionStateAccumulator` and returns the current
 * `SessionState` plus an `apply(msg)` feeder. Wire a dashboard WebSocket's
 * `onmessage` (parsed) to `apply`. When `sessionId` is provided, messages for
 * other sessions are ignored.
 */
export function useSessionState(sessionId?: string): UseSessionStateResult {
  const accRef = useRef<SessionStateAccumulator>(createSessionAccumulator());
  const [state, setState] = useState<SessionState>(accRef.current.state);

  const apply = useCallback(
    (msg: ServerToBrowserMessage) => {
      if (
        sessionId != null &&
        "sessionId" in msg &&
        (msg as { sessionId?: string }).sessionId !== sessionId
      ) {
        return;
      }
      const next = applySessionMessage(accRef.current, msg);
      if (next === accRef.current) return;
      accRef.current = next;
      setState(next.state);
    },
    [sessionId],
  );

  const reset = useCallback(() => {
    accRef.current = createSessionAccumulator();
    setState(accRef.current.state);
  }, []);

  return { state, apply, reset };
}
