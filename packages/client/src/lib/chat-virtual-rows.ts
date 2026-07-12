/**
 * Pure helpers for the windowed (TanStack Virtual) chat transcript.
 *
 * `ChatView` renders a windowed list over the heterogeneous `displayRows`
 * (the prefs-filtered `groupToolBursts` output). These helpers are the pure,
 * unit-testable core of that windowing — the virtualizer key, the per-row-type
 * pre-measure size estimate, and the `turnIndex → first-row-index` map that
 * backs `ChatViewHandle.scrollToTurn`.
 *
 * See change: virtualize-chat-transcript-tanstack (Phase 2 Step B). Doubt-Review
 * corrections CR-3 (per-type key), CR-4 (turn map over the filtered rows).
 */
import type { ChatMessage } from "./event-reducer.js";
import type { BurstItem, ToolBurstGroup } from "./group-tool-bursts.js";
import type { ToolCallGroup } from "./group-tool-calls.js";

/** A temporal burst group row. */
export function isBurst(item: BurstItem): item is ToolBurstGroup {
  return (item as ToolBurstGroup).type === "burst";
}

/** A bare semantic ×N group row. */
export function isGroup(item: BurstItem): item is ToolCallGroup {
  return (item as ToolCallGroup).type === "group";
}

/**
 * Stable virtualizer/React key for a display row (CR-3). Mirrors the current
 * render keys per row type:
 *   burst  → `burst.id` (first tool-like member id; survives head-trim churn)
 *   group  → first member id, else `group-<index>` (never a bare `toolName`,
 *            which collides across two sub-threshold bursts of the same tool)
 *   message→ `msg.id`
 * Uniqueness is a hard precondition for measurement caching under windowing.
 */
export function virtualRowKey(item: BurstItem, index: number): string {
  if (isBurst(item)) return item.id;
  if (isGroup(item)) return item.messages[0]?.id ?? `group-${index}`;
  return (item as ChatMessage).id;
}

/**
 * Per-row-type pre-measure size estimate (task 2.2). Only affects first-paint
 * offset error — `measureElement` caches each row's real rendered height after
 * mount. A per-type estimate beats one global constant (a burst group is far
 * taller than a turn separator), reducing scroll drift before measurement.
 */
export function estimateVirtualRowSize(item: BurstItem): number {
  if (isBurst(item)) return 220;
  if (isGroup(item)) return 64;
  const msg = item as ChatMessage;
  switch (msg.role) {
    case "turnSeparator":
      return 24;
    case "commandFeedback":
      return 48;
    case "thinking":
      return 72;
    case "user":
      // Image-bearing user rows are far taller than a text bubble. A taller
      // pre-mount estimate bounds first-paint scroll drift before the
      // decode-driven re-measure lands (measurement stays authoritative).
      return (msg.images?.length ?? 0) > 0 ? 320 : 96;
    case "toolResult":
      return 120;
    case "rawEvent":
      return 120;
    case "assistant":
      return 140;
    case "bashOutput":
      return 160;
    case "interactiveUi":
      return 160;
    case "inlineTerminal":
      return 220;
    default:
      return 120;
  }
}

/**
 * Build `turnIndex → first display-row index` (CR-4, Decision 4).
 *
 * `turnIndex` is assigned only to the (last) user message of a turn, not to
 * burst/group rows. A turn's navigable rows are therefore the top-level
 * `ChatMessage` rows carrying `turnIndex` — the same rows that render
 * `data-turn` today. First row wins (a later duplicate turnIndex is ignored).
 * Built over the FILTERED `displayRows` so the resulting index feeds
 * `virtualizer.scrollToIndex` directly.
 */
export function buildTurnToFirstRowIndex(rows: BurstItem[]): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    if (isBurst(item) || isGroup(item)) continue;
    const turnIndex = (item as ChatMessage).turnIndex;
    if (turnIndex != null && !map.has(turnIndex)) {
      map.set(turnIndex, i);
    }
  }
  return map;
}
