/**
 * Two related collapse helpers used by ChatView to remove visual duplicates:
 *
 * 1. `findRetriedErrorIds` — failed toolResult immediately superseded by a
 *    successful retry of the same tool (see RetriedErrorBadge).
 * 2. `findActiveInteractiveToolResultIds` — a *running* toolResult paired
 *    with a *pending* interactiveUi message that follows it. The interactive
 *    card already shows the question + buttons, so the running tool card is
 *    pure duplication while the user has not yet answered. Once the prompt
 *    resolves, the toolResult flips to `complete` (no longer matches) and
 *    the chat shows the full tool card in history.
 *
 * Identifies failed `toolResult` messages that were immediately superseded
 * by a successful retry of the same tool, so the chat view can collapse
 * them into a compact "retried" badge instead of a full error card.
 *
 * Heuristic: an error toolResult is "retried" if, walking forward through
 * the message array and skipping intermediate `assistant` / `thinking` /
 * `turnSeparator` / `rawEvent` items, the very next `toolResult` shares
 * the same `toolName` AND has `toolStatus !== "error"`. Encountering a
 * `user` message, a different tool's `toolResult`, or running out of
 * messages aborts the look-ahead (the error is NOT considered retried).
 *
 * Pure / side-effect-free — returns a Set of message ids.
 */
import type { ChatMessage } from "./event-reducer.js";

const SKIP_ROLES: ReadonlySet<ChatMessage["role"]> = new Set([
  "assistant",
  "thinking",
  "turnSeparator",
  "rawEvent",
  "commandFeedback",
]);

export function findRetriedErrorIds(messages: ChatMessage[]): Set<string> {
  const retried = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "toolResult") continue;
    if (m.toolStatus !== "error") continue;
    if (!m.toolName) continue;

    // Look ahead, skipping non-blocking message kinds.
    for (let j = i + 1; j < messages.length; j++) {
      const next = messages[j];
      if (SKIP_ROLES.has(next.role)) continue;
      if (next.role !== "toolResult") break; // user / bashOutput / interactiveUi etc → abort
      if (next.toolName !== m.toolName) break; // different tool → not a retry
      if (next.toolStatus === "error") break; // chained errors → don't collapse the first
      // Successful (or running) retry of the same tool.
      retried.add(m.id);
      break;
    }
  }

  return retried;
}

/**
 * Returns ids of toolResults that are paired with a `pending` `interactiveUi`
 * message. ChatView hides these to avoid duplicating the question card while
 * the user has not yet answered.
 *
 * Pairing rule: a toolResult is paired with the very next non-skip message if
 * that message is an `interactiveUi` with `args.status === "pending"`. Skip
 * roles are the same as for retry detection (`assistant` / `thinking` /
 * `turnSeparator` / `rawEvent` / `commandFeedback`).
 *
 * The toolResult's own status is ignored on purpose: after a server restart,
 * `state-replay.ts` synthesizes a `tool_execution_end` for every orphan tool
 * call (including legitimately-pending `ask_user`), so the toolResult arrives
 * as `complete` while the prompt replayed from the in-memory pending-prompt
 * cache is still `pending`. Both must collapse to a single Confirm card.
 * Once the user answers, the interactiveUi flips to `resolved` / `cancelled`,
 * the helper stops hiding, and the chat shows the full tool card in history.
 */
/**
 * Single-red-surface guarantee (extends beyond the banner selector). While
 * the error-lifecycle surface owns a failure for the session (the
 * `SessionBanner` is rendering an error and/or a retry, i.e.
 * `surfaceActive === true`), the inline chat stream MUST NOT render a second
 * full red error card for that same failure. Returns the id of the trailing
 * failed `toolResult` (the inline duplicate of the active surface failure) so
 * ChatView collapses it to a compact `RetriedErrorBadge` instead of a full
 * red card. Yellow (retry sub-status) and red (settled error) then never
 * appear on two separate surfaces at once for the same session.
 *
 * Rule: walk `messages` from the tail; the first `toolResult` with
 * `toolStatus === "error"` before a `user` boundary is the current-turn
 * failure and is suppressed. Returns an empty set when the surface is inactive
 * or no trailing failed tool exists (e.g. a pure LLM/provider error with no
 * failed tool card to duplicate).
 *
 * Pure / side-effect-free. See change: unify-error-retry-lifecycle.
 */
export function findSurfaceSuppressedErrorIds(
  messages: ChatMessage[],
  surfaceActive: boolean,
): Set<string> {
  const suppressed = new Set<string>();
  if (!surfaceActive) return suppressed;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") break; // only the current turn's failure is relevant
    if (m.role === "toolResult" && m.toolStatus === "error") {
      suppressed.add(m.id);
      break;
    }
  }
  return suppressed;
}

export function findActiveInteractiveToolResultIds(messages: ChatMessage[]): Set<string> {
  const hidden = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "toolResult") continue;

    for (let j = i + 1; j < messages.length; j++) {
      const next = messages[j];
      if (SKIP_ROLES.has(next.role)) continue;
      if (next.role !== "interactiveUi") break;
      const status = (next.args as { status?: string } | undefined)?.status;
      if (status === "pending") hidden.add(m.id);
      break;
    }
  }

  return hidden;
}
