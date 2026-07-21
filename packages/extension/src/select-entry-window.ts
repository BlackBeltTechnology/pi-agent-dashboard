/**
 * Bridge-side tail-window selector for pi session entries
 * (change: bound-bridge-resume-replay, D1).
 *
 * The server already bounds its browser-facing replay via `select-window.ts`
 * (event-level). This is the peer helper on the bridge side: it bounds the
 * bridge→server re-forward of pi session entries on resume/reattach so the
 * bridge never replays a whole 90 MB branch in one synchronous burst.
 *
 * The window targets `budget` entries, then extends its START backward to the
 * nearest safe cut point — a boundary at which no tool span is open (every
 * assistant `toolCall` entry has seen its matching `toolResult` entry) — so the
 * bounded tail never begins with an orphaned `tool_execution_end`. The backward
 * extension is bounded by a hard cap of `2 × budget`; if no safe cut exists
 * within the cap, the window starts at the cap boundary.
 *
 * Message spans need no tracking here: `replayEntriesAsEvents` emits
 * `message_start`/`message_update`/`message_end` from a SINGLE assistant entry,
 * so a message span never crosses an entry boundary. Only tool spans (an
 * assistant `toolCall` entry paired with a later `toolResult` entry) can.
 */
import { BRIDGE_REPLAY_TAIL_ENTRIES } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

/**
 * Default bridge tail-window budget in ENTRIES. Sized generously above the
 * server's 200-event `TAIL_WINDOW_EVENTS` budget (+ its 2× safe-cut cap) so the
 * bounded tail always fully covers the window the server later selects for the
 * browser. Each pi entry expands to ≥1 dashboard event, so 500 entries yields
 * ≥500 events — comfortably above the server's 400-event hard cap.
 */
export const BRIDGE_TAIL_ENTRIES = BRIDGE_REPLAY_TAIL_ENTRIES;

export interface EntryWindowResult {
  /** The selected tail window, in original (ascending) order. */
  entries: any[];
  /** True when older entries precede the window (not eagerly re-forwarded). */
  hasOlder: boolean;
}

/**
 * Compute, for each boundary `i` (0..entries.length), whether starting the
 * window at `entries[i]` leaves NO tool span open — i.e. folding
 * `entries[0..i-1]` closes every tool call it opened. `safe[0]` is always true
 * (nothing precedes). The counter clamps at 0 so a pre-existing orphan
 * `toolResult` cannot drive it negative.
 */
function computeSafeBoundaries(entries: any[]): boolean[] {
  const safe = new Array<boolean>(entries.length + 1);
  let toolOpen = 0;
  safe[0] = true;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const msg = entry?.message;
    if (entry?.type === "message" && msg) {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part?.type === "toolCall") toolOpen++;
        }
      } else if (msg.role === "toolResult" && msg.toolCallId) {
        toolOpen = Math.max(0, toolOpen - 1);
      }
    }
    safe[i + 1] = toolOpen === 0;
  }
  return safe;
}

/**
 * Select a bounded tail window from `entries` (ascending, from
 * `sessionManager.getBranch()`).
 *
 * @param entries full ascending branch entry list
 * @param budget  target window size in entries
 */
export function selectEntryWindow(
  entries: any[],
  budget: number = BRIDGE_TAIL_ENTRIES,
): EntryWindowResult {
  if (entries.length <= budget) {
    return { entries: entries.slice(), hasOlder: false };
  }

  const capFloor = Math.max(0, entries.length - 2 * budget);
  const naiveStart = entries.length - budget;
  const safe = computeSafeBoundaries(entries);

  // Extend backward from the naive start to the nearest safe cut point within
  // the hard cap; fall back to the cap boundary when none exists.
  let start = capFloor;
  for (let s = naiveStart; s >= capFloor; s--) {
    if (safe[s]) {
      start = s;
      break;
    }
  }

  return { entries: entries.slice(start), hasOlder: start > 0 };
}
