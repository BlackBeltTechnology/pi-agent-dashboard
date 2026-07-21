/**
 * Tail-first replay window selection (change: tail-first-session-loading).
 *
 * A single pure helper backs both construction sites so they cannot drift:
 *   - tail window   (`beforeSeq === undefined`): the newest events on a
 *     `lastSeq: 0` subscribe.
 *   - older window  (`beforeSeq` set): the previous page for a `load_older`
 *     request, covering seqs strictly below `beforeSeq`.
 *
 * The window targets `budget` events and then extends its START backward to the
 * nearest safe cut point — a boundary at which no assistant-message span and no
 * tool span is open — so the client's order-dependent reducer never folds from
 * the middle of a `message_start … message_end` / `tool_execution_start …
 * tool_execution_end` pair. The backward extension is bounded by a hard cap of
 * `2 × budget`; if no safe cut exists within the cap, the window starts at the
 * cap boundary and the client drops the leading orphan span fragments.
 */
import type { StoredEvent } from "../memory-event-store.js";

/** Default tail-window budget in events. Tuned via the measurement task. */
export const TAIL_WINDOW_EVENTS = 200;

export interface WindowResult {
  /** The selected window, ascending by seq. */
  events: StoredEvent[];
  /** True when older events precede the window (scroll-up pagination available). */
  hasOlder: boolean;
}

/** Events that open/close a message span. */
const MSG_OPEN = "message_start";
const MSG_CLOSE = "message_end";
/** Events that open/close a tool span. */
const TOOL_OPEN = "tool_execution_start";
const TOOL_CLOSE = "tool_execution_end";

/**
 * Compute, for each boundary `i` (0..pool.length), whether starting the window
 * at `pool[i]` leaves NO span open — i.e. folding `pool[0..i-1]` closes every
 * message and tool span it opened. `safe[0]` is always true (nothing precedes).
 * Counters clamp at 0 so a pre-existing orphan close cannot drive them negative.
 */
function computeSafeBoundaries(pool: StoredEvent[]): boolean[] {
  const safe = new Array<boolean>(pool.length + 1);
  let msgOpen = 0;
  let toolOpen = 0;
  safe[0] = true;
  for (let i = 0; i < pool.length; i++) {
    const t = pool[i].event.eventType;
    if (t === MSG_OPEN) msgOpen++;
    else if (t === MSG_CLOSE) msgOpen = Math.max(0, msgOpen - 1);
    else if (t === TOOL_OPEN) toolOpen++;
    else if (t === TOOL_CLOSE) toolOpen = Math.max(0, toolOpen - 1);
    safe[i + 1] = msgOpen === 0 && toolOpen === 0;
  }
  return safe;
}

/**
 * Select a replay window from `events` (ascending by seq).
 *
 * @param events  full ascending event list for the session
 * @param beforeSeq  when set, restrict to events with `seq < beforeSeq` (older
 *                   page); when undefined, select the tail
 * @param budget  target window size in events
 */
export function selectWindow(
  events: StoredEvent[],
  beforeSeq: number | undefined,
  budget: number = TAIL_WINDOW_EVENTS,
): WindowResult {
  const pool =
    beforeSeq === undefined ? events : events.filter((e) => e.seq < beforeSeq);

  // `hasOlder` means "real history precedes this window". Derive it from the
  // window's first event reaching seq 1, NOT from a positive slice offset:
  // the memory store trims oldest non-essential events under pressure, leaving
  // seq GAPS. A gapped buffer whose oldest seq is (say) 3120 must not advertise
  // pages below itself forever — the client can never fill a hole the server
  // no longer holds. See change: tail-first-session-loading (doubt: gap-aware).
  const olderExists = (windowStartSeq: number): boolean => windowStartSeq > 1;

  // Whole pool fits within budget → window covers everything available.
  if (pool.length <= budget) {
    return { events: pool.slice(), hasOlder: pool.length > 0 && olderExists(pool[0].seq) };
  }

  const capFloor = Math.max(0, pool.length - 2 * budget);
  const naiveStart = pool.length - budget;
  const safe = computeSafeBoundaries(pool);

  // Extend backward from the naive start to the nearest safe cut point within
  // the hard cap; fall back to the cap boundary (unsafe) when none exists.
  let start = capFloor;
  for (let s = naiveStart; s >= capFloor; s--) {
    if (safe[s]) {
      start = s;
      break;
    }
  }

  const windowed = pool.slice(start);
  return { events: windowed, hasOlder: olderExists(windowed[0].seq) };
}
