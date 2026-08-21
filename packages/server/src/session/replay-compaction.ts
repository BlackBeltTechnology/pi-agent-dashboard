/**
 * Replay-only stream compaction (change: compact-warm-replay-stream, issue #399).
 *
 * A WARM (in-memory) session window is the raw live stream: every assistant
 * `message_update` carries a FULL SNAPSHOT of the accumulated content, not a
 * delta. Replaying all of them on reopen ships ~20k events where the COLD
 * (on-disk) path — `packages/shared/src/state-replay.ts` — synthesizes ~1k for
 * the same conversation. This pass makes the warm window converge on that
 * shape, REPLAY ONLY; the store keeps the full stream for the live path,
 * "Show full output", and status extraction.
 *
 * Same hook and same spirit as the sibling `replay-truncate.ts`.
 *
 * ── The rule (design D1, narrowed by the equivalence gate) ──────────────────
 *
 * Drop every `message_update` positioned BEFORE the last `message_end` in the
 * window, with two exemptions:
 *
 *   1. THINKING updates — `data.assistantMessageEvent.type` starting with
 *      `thinking` (`thinking_start | thinking_delta | thinking_end`). The
 *      client builds `role:"thinking"` rows from these with `startedAt` +
 *      `duration`; the `message_end` reconstruction path
 *      (`reconstruct-reasoning-on-replay`) rebuilds a row WITHOUT them, so
 *      dropping thinking updates is not state-equivalent. Decided empirically
 *      by `replay-compaction-equivalence.test.ts` (D2), not by assumption.
 *
 *   2. The LAST text-bearing `message_update` before each
 *      `tool_execution_start`. At `tool_execution_start` the reducer FLUSHES
 *      `streamingText` into a permanent assistant row keyed `flush-<toolCallId>`
 *      (`fix-streaming-text-vs-interactive-ui-order`). With no preceding
 *      update, `streamingText` is empty, no flush happens, and the row is
 *      instead pushed at `message_end` with a different id and position.
 *      Because snapshots are CUMULATIVE, keeping only the last update before
 *      the tool start reproduces `streamingText` exactly.
 *
 * Everything after the last `message_end` is the still-streaming tail and is
 * kept verbatim. Non-`message_update` events always pass through untouched.
 *
 * Seq values are NEVER rewritten — the client's `getEvents` filter tolerates
 * gaps, and monotonicity is what the reset rule depends on. The caller must
 * still report the PRE-compaction high-water mark (design D4).
 *
 * COUPLING: this rule is defined by `packages/client/src/lib/chat/event-reducer.ts`
 * (`message_update` / `message_end` / `tool_execution_start` arms). Any change
 * to how the reducer consumes `streamingText` or thinking events invalidates it.
 * `replay-compaction-equivalence.test.ts` is the guard — it reduces raw vs
 * compacted with the real client reducer and asserts deep equality.
 */
import type { StoredEvent } from "../persistence/memory-event-store.js";

function isThinkingUpdate(event: StoredEvent["event"]): boolean {
  const ame = event.data?.assistantMessageEvent as { type?: unknown } | undefined;
  return typeof ame?.type === "string" && ame.type.startsWith("thinking");
}

/**
 * Compact a replay window. Pure: returns a NEW array, never mutates the input
 * or any event object (survivors are passed through by reference).
 *
 * `supersessionBoundaryIdx` (optional) is the index BEFORE which non-exempt
 * `message_update` events are considered superseded. Omitted, it defaults to
 * this array's own last `message_end` — exactly today's behaviour, so every
 * existing caller is unchanged.
 *
 * A caller MUST supply it when compacting a SLICE of a larger stream: the
 * derived boundary is array-relative, so a gap slice would keep updates whose
 * `message_end` lives outside the slice (in the already-delivered tail),
 * re-serving stale cumulative snapshots over a closed message. For a gap slice
 * a later `message_end` always exists in the tail, so the whole slice is
 * superseded — pass `slice.length`. Skipping compaction instead is strictly
 * worse: the store retains every snapshot, so an un-compacted slice serves ALL
 * of them.
 * See change: lazy-load-session-history (D7).
 */
export function compactEventsForReplay(
  stored: StoredEvent[],
  supersessionBoundaryIdx?: number,
): StoredEvent[] {
  if (stored.length === 0) return [];

  // Pass 1 — locate the supersession boundary (last message_end) and the index
  // of the last text-bearing update preceding each tool_execution_start.
  let lastMessageEndIdx = -1;
  const keepIndices = new Set<number>();
  let pendingTextUpdateIdx = -1;
  for (let i = 0; i < stored.length; i++) {
    const type = stored[i].event.eventType;
    if (type === "message_end") {
      lastMessageEndIdx = i;
      continue;
    }
    if (type === "message_update") {
      if (!isThinkingUpdate(stored[i].event)) pendingTextUpdateIdx = i;
      continue;
    }
    if (type === "tool_execution_start" && pendingTextUpdateIdx >= 0) {
      // The update that seeds the flushed assistant row. Keep it; reset so a
      // second tool call in the same message does not re-keep a stale index.
      keepIndices.add(pendingTextUpdateIdx);
      pendingTextUpdateIdx = -1;
    }
  }

  // An external boundary REPLACES the derived one, including the
  // nothing-finalized-yet short-circuit: a slice with no `message_end` of its
  // own is exactly the case the caller is correcting for.
  const boundary = supersessionBoundaryIdx ?? lastMessageEndIdx;
  if (boundary < 0) return stored.slice(); // nothing finalized yet

  // Pass 2 — emit.
  const out: StoredEvent[] = [];
  for (let i = 0; i < stored.length; i++) {
    const entry = stored[i];
    if (
      i < boundary &&
      entry.event.eventType === "message_update" &&
      !isThinkingUpdate(entry.event) &&
      !keepIndices.has(i)
    ) {
      continue;
    }
    out.push(entry);
  }
  return out;
}
