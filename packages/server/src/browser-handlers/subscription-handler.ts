/**
 * Subscription message handlers: subscribe, unsubscribe.
 */

import type {
  BrowserToServerMessage,
  HistoryBackfillResultMessage,
  ServerToBrowserMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { DEFAULT_MEMORY_LIMITS } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { WebSocket } from "ws";
import {
  type PendingAttachment,
  prepareEventForIngest,
} from "../attachments/attachment-ingest.js";
import { createAttachmentResolver } from "../attachments/attachment-resolver.js";
import type { StoredEvent } from "../persistence/memory-event-store.js";
import { pluginIntentCache } from "../plugin-intent-cache.js";
import { extractStatsFromEvents } from "../session/event-status-extraction.js";
import { compactEventsForReplay } from "../session/replay-compaction.js";
import { truncateToolResultForReplay } from "../session/replay-truncate.js";
import type { BrowserHandlerContext } from "./handler-context.js";

/**
 * Raised 50 → 200. Each batch is one client React commit, so a large warm
 * window used to cost hundreds of commits. With `compactEventsForReplay`
 * removing the superseded snapshot updates, a 200-event batch stays well under
 * BACKPRESSURE_THRESHOLD. See change: compact-warm-replay-stream (D5).
 */
const REPLAY_BATCH_SIZE = 200;
/** Max buffered bytes before pausing replay sends (1MB) */
const BACKPRESSURE_THRESHOLD = 1_024 * 1_024;
/**
 * Interval between cold-hydration keepalive markers. While `loadSessionEvents`
 * parses a large on-disk session, re-emit the empty non-terminal
 * `event_replay { events: [], isLast: false }` so the client's hydration ceiling
 * never lapses and flashes "No messages yet". ≪ the client's HYDRATE_CEILING_MS.
 * See change: fix-history-loading-false-empty-flash.
 */
const HYDRATE_HEARTBEAT_MS = 10000;

/**
 * Head/tail window geometry. `HEAD_RATIO` of the budget goes to the head,
 * floored at `HEAD_MIN` and capped at `HEAD_CAP`; the remainder is the tail.
 *
 * The floor is load-bearing: a bare `min(HEAD_CAP, floor(limit * 0.1))` yields
 * `head = 0` for any limit under 10, silently degrading to tail-only — the
 * shape D3 exists to reject. `HEAD_MIN` plus the config-level
 * `MIN_REPLAY_WINDOW` makes a head-free window unreachable by configuration.
 * See change: lazy-load-session-history (D3).
 */
const HEAD_RATIO = 0.1;
export const HEAD_MIN = 20;
export const HEAD_CAP = 200;
/**
 * How far either cut edge may scan for a message boundary. Bounded so a window
 * computation can never degrade into a full scan of the array.
 * See change: lazy-load-session-history (D4).
 */
export const SNAP_LOOKUP = 200;
/**
 * Hard ceiling on the number of events one `history_backfill` may serve. The
 * span is attacker-controlled and is otherwise a request-amplification lever —
 * one small frame forcing an arbitrarily large serialize + send.
 * See change: lazy-load-session-history (D9).
 */
export const BACKFILL_MAX_SPAN = 500;

/**
 * Snap an inclusive LOWER cut forward to the next `message_start` / `turn_start`
 * within `SNAP_LOOKUP`. Returns `start` when no boundary is found — snapping is
 * best-effort and may only ever SHRINK the range.
 *
 * Extracted from `computeReplayWindow` so a backfill slice can snap its
 * gap-facing edge with the identical rule.
 * See change: fix-lazy-history-backfill-ux (D4).
 */
function snapLowerEdgeForward(events: StoredEvent[], start: number): number {
  const ceil = Math.min(events.length - 1, start + SNAP_LOOKUP);
  for (let i = start; i <= ceil; i++) {
    const type = events[i].event.eventType;
    if (type === "message_start" || type === "turn_start") return i;
  }
  return start;
}

/**
 * Snap an EXCLUSIVE upper cut backward to just past the last completed
 * `message_end` within `SNAP_LOOKUP`. Returns `end` when no boundary is found.
 * See change: fix-lazy-history-backfill-ux (D4).
 */
function snapUpperEdgeBack(events: StoredEvent[], end: number): number {
  const floor = Math.max(0, end - SNAP_LOOKUP);
  for (let i = end - 1; i >= floor; i--) {
    if (events[i].event.eventType === "message_end") return i + 1;
  }
  return end;
}

/** Per-(socket, session) gap bookkeeping for the backfill handler. */
interface GapState {
  /** Last seq the client holds in the head; ADVANCES as backfill fills the gap. */
  headMaxSeq: number;
  /**
   * First seq of the tail segment; RETREATS as backfill fills the gap from the
   * tail side. Both edges are mutable: the gap is symmetric, and a served range
   * is credited to whichever edge it abuts (tail wins when it abuts both).
   * See change: fix-lazy-history-backfill-ux (D1, D1a).
   */
  tailMinSeq: number;
  /** Monotonic subscribe counter; a completion at a different value is stale. */
  generation: number;
  /** Single-flight latch. A second concurrent request is refused, not queued. */
  inFlight: boolean;
}

/**
 * Per-connection state, keyed weakly so a closed socket's entry is collectable
 * without an explicit teardown hook.
 */
const gapStates = new WeakMap<WebSocket, Map<string, GapState>>();

function gapMapFor(ws: WebSocket): Map<string, GapState> {
  let map = gapStates.get(ws);
  if (!map) {
    map = new Map();
    gapStates.set(ws, map);
  }
  return map;
}

/**
 * Bump the subscription generation for a (socket, session) and drop any gap
 * bookkeeping from the previous subscription. A backfill still in flight across
 * this boundary completes against the OLD window, so it is answered with
 * `stale_generation` rather than spliced — a late response computed against the
 * old window can carry seqs that overlap the new window's head or tail.
 * See change: lazy-load-session-history (D9).
 */
function bumpSubscriptionGeneration(ws: WebSocket, sessionId: string): number {
  const map = gapMapFor(ws);
  const prev = map.get(sessionId);
  const generation = (prev?.generation ?? 0) + 1;
  map.set(sessionId, { headMaxSeq: 0, tailMinSeq: 0, generation, inFlight: false });
  return generation;
}

/** Drop all gap bookkeeping for a (socket, session). Called on unsubscribe. */
export function clearGapState(ws: WebSocket, sessionId: string): void {
  gapStates.get(ws)?.delete(sessionId);
}

/** TEST-ONLY read of the recorded gap bounds for a (socket, session). */
export function peekGapState(ws: WebSocket, sessionId: string): Readonly<GapState> | undefined {
  return gapStates.get(ws)?.get(sessionId);
}

/** Index bounds of a computed replay window: `[0, headEnd)` ∪ `[tailStart, len)`. */
export interface ReplayWindow {
  /** Exclusive end index of the head segment. */
  headEnd: number;
  /** Inclusive start index of the tail segment. */
  tailStart: number;
}

/**
 * Compute the head/tail split for a compacted replay array, or `null` when the
 * window does not apply.
 *
 * The fits-entirely short-circuit (`compacted.length <= windowLimit`) is not an
 * optimization — it makes the overlap case UNREPRESENTABLE. `MIN_REPLAY_WINDOW`
 * is validated per-VALUE, not per-session, so a 40-event session under a
 * `1000` setting is always reachable; without the guard `head(100)` and
 * `tail(900)` overlap, emit duplicate seqs, and `gapCount` goes negative.
 *
 * Both cut edges SNAP, and both snaps SHRINK the window:
 *   - the tail's leading edge snaps FORWARD to the next `message_start` /
 *     `turn_start`. Forward, not backward, because backward snapping ADDS
 *     events beyond the budget — a user setting 500 could receive ~700, making
 *     `maxReplayEvents` a soft floor. Forward drops a few of the oldest tail
 *     events instead, so the budget stays a HARD cap.
 *   - the head's trailing edge snaps BACKWARD to a completed `message_end`, so
 *     the head cannot end on a dangling `message_start` and strand a
 *     permanently "streaming" row in the UI.
 *
 * Both are BEST-EFFORT: neither may find a boundary within `SNAP_LOOKUP`, so
 * the reducer must tolerate an orphan at either edge. Snapping raises quality;
 * reducer tolerance is the correctness guarantee.
 * See change: lazy-load-session-history (D3, D4).
 */
export function computeReplayWindow(
  compacted: StoredEvent[],
  windowLimit: number,
): ReplayWindow | null {
  if (windowLimit <= 0) return null;
  if (compacted.length <= windowLimit) return null;

  const head = Math.min(HEAD_CAP, Math.max(HEAD_MIN, Math.floor(windowLimit * HEAD_RATIO)));
  const tail = windowLimit - head;

  // Head trailing edge → backward to a completed `message_end` (shrinks).
  const headEnd = snapUpperEdgeBack(compacted, head);
  // Tail leading edge → forward to the next message/turn start (shrinks).
  const tailStart = snapLowerEdgeForward(compacted, compacted.length - tail);

  // A snap must never invert the split (possible only for a degenerate array).
  if (tailStart < headEnd) return null;
  return { headEnd, tailStart };
}

/**
 * Send stored events to a WebSocket in batches with backpressure handling.
 * Yields between batches to let the event loop flush data and avoid OOM.
 *
 * Returns the PRE-compaction highest seq of the window, or 0 if nothing was
 * sent. Compaction can drop the highest-seq event (a still-superseded
 * `message_update`); returning the last SURVIVING seq would make
 * `clearReplaying` re-send already-covered events as a catch-up batch.
 * See change: compact-warm-replay-stream (D4).
 *
 * Exported so unit tests can drive the batching / backpressure / socket-close
 * paths directly, mirroring `replayUiState` / `replaySessionAssets`.
 *
 * `windowLimit` (optional, 0 = disabled) bounds what reaches the browser. The
 * caller passes it ONLY when the array it hands over is a full stream (D1) —
 * windowing a genuine delta would punch a seq gap between what the client holds
 * and what it receives. When a window applies, a `history_window` message is
 * emitted BEFORE the first `event_replay` so the client can render the gap
 * affordance in the right place.
 * See change: lazy-load-session-history (D1, D2).
 */
export async function sendEventBatches(
  ws: WebSocket,
  sessionId: string,
  stored: StoredEvent[],
  sendTo: (ws: WebSocket, msg: ServerToBrowserMessage) => void,
  windowLimit?: number,
): Promise<number> {
  // High-water mark is computed from the PRE-compaction window (D4).
  const preCompactionMaxSeq = stored.length > 0 ? stored[stored.length - 1].seq : 0;
  // Replay-only stream compaction: drop assistant `message_update` snapshots
  // superseded by a later `message_end`, bringing the warm (in-memory) window
  // down to the cold (on-disk) path's shape. The store keeps the full stream.
  // See change: compact-warm-replay-stream.
  const full = compactEventsForReplay(stored);
  // Window AFTER compaction (D2). Compaction is ~20:1, so budget spent
  // pre-compaction is mostly spent on snapshots discarded microseconds later;
  // the same N post-compaction buys far more actual conversation.
  //
  // D4 survives because `preCompactionMaxSeq` above is read from the FULL
  // INPUT array. It is emphatically NOT "the last event of the window":
  // compaction can drop the highest-seq event (a still-superseded
  // `message_update`) and the window can drop more. Deriving the return value
  // from `compacted` would return a lower seq and make `clearReplaying`
  // re-send already-delivered events.
  const replayWindow = computeReplayWindow(full, windowLimit ?? 0);
  let compacted = full;
  if (replayWindow) {
    compacted = [...full.slice(0, replayWindow.headEnd), ...full.slice(replayWindow.tailStart)];
    const headMaxSeq = full[replayWindow.headEnd - 1].seq;
    const tailMinSeq = full[replayWindow.tailStart].seq;
    // `gapCount` counts the gap events the store ACTUALLY HOLDS — never the seq
    // distance. For a middle-trimmed session the stored array is itself
    // non-contiguous, so `tailMinSeq - headMaxSeq - 1` OVERSTATES what exists
    // and a "N earlier messages" divider would promise rows trimmed months ago.
    let gapCount = 0;
    let oldestGapSeq = 0;
    for (const e of stored) {
      if (e.seq > headMaxSeq && e.seq < tailMinSeq) {
        gapCount++;
        if (oldestGapSeq === 0) oldestGapSeq = e.seq;
      }
    }
    // Record the gap bounds so `handleHistoryBackfill` can clamp into them
    // without re-deriving the window. `headMaxSeq` ADVANCES as backfill fills
    // the gap from the head side, which is what makes `remainingGapCount`
    // — and therefore the client's stop rule — terminate.
    /**
     * Record the bounds so `handleHistoryBackfill` can clamp into them without
     * re-deriving the window. `headMaxSeq` ADVANCES as backfill fills the gap
     * from the head side, which is what makes `remainingGapCount` — and
     * therefore the client's stop rule — terminate.
     *
     * Absent entry = this socket has no live subscription for the session (it
     * unsubscribed, or a direct call registered none). The announcement still
     * goes out — it is computed from the very events being delivered on this
     * call, so it is never stale relative to them — but there is no
     * subscription to record against. A client that has since re-subscribed is
     * protected by the `session_state_reset` that precedes every windowed
     * full-stream replay, which drops its gap state.
     */
    const gap = gapStates.get(ws)?.get(sessionId);
    if (gap) {
      gap.headMaxSeq = headMaxSeq;
      gap.tailMinSeq = tailMinSeq;
    }
    if (ws.readyState === ws.OPEN) {
      sendTo(ws, { type: "history_window", sessionId, headMaxSeq, tailMinSeq, gapCount, oldestGapSeq });
    }
  }
  // Terminate an empty payload explicitly. The loop below cannot run when there
  // is nothing to batch, so without this a warm empty delta (or a cold session
  // that parses to zero events) would send NO `event_replay` at all and the
  // client's replay-in-flight flag would have no clearing edge. Only the empty
  // case: a non-empty payload's final batch already carries `isLast: true`, so
  // appending here unconditionally would double-terminate an exact multiple of
  // REPLAY_BATCH_SIZE. See change: show-replay-in-flight-indicator (D6).
  if (compacted.length === 0) {
    if (ws.readyState !== ws.OPEN) return 0;
    sendTo(ws, { type: "event_replay", sessionId, events: [], isLast: true });
    return preCompactionMaxSeq;
  }
  for (let i = 0; i < compacted.length; i += REPLAY_BATCH_SIZE) {
    if (ws.readyState !== ws.OPEN) return 0;
    const batch = compacted.slice(i, i + REPLAY_BATCH_SIZE);
    sendTo(ws, {
      type: "event_replay",
      sessionId,
      // Strategy B (reduce-session-replay-traffic): pre-truncate heavy tool
      // results to the display form to trim replay bytes. Additive — the store
      // keeps the full body for develop's "Show full output" route; small
      // results and non-tool events pass through untouched.
      events: batch.map((e) => ({ seq: e.seq, event: truncateToolResultForReplay(e.event) })),
      isLast: i + REPLAY_BATCH_SIZE >= compacted.length,
    });
    // Yield to event loop between batches to allow GC and buffer flushing
    if (ws.bufferedAmount > BACKPRESSURE_THRESHOLD) {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (ws.readyState !== ws.OPEN || ws.bufferedAmount < BACKPRESSURE_THRESHOLD) {
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        setTimeout(check, 10);
      });
    } else {
      await new Promise<void>((r) => setImmediate(r));
    }
  }
  return preCompactionMaxSeq;
}

/**
 * Replay extension-declared UI state to a single browser. Sends:
 *
 *   1. one `ui_modules_list` (when modules exist)                  — Phase 1
 *   2. one `ui_data_list` per cached `(event, items)` entry         — Phase 1
 *   3. one `ext_ui_decorator` per cached `Session.uiDecorators` entry — Phase 2
 *
 * Replay decorator messages NEVER carry `removed: true` — only live entries
 * are replayed; deleted entries are already absent from the cache.
 *
 * Called immediately after every `replayPendingUiRequests` site so the full
 * replay ordering is:
 *
 *   asset_register batch → events → pending UI requests → ui_modules_list → ui_data_list → ext_ui_decorator
 *
 * Exported so unit tests can drive it without standing up a full subscribe
 * pipeline. See changes: add-extension-ui-modal, add-extension-ui-decorations.
 */
export function replayUiState(
  ws: WebSocket,
  sessionId: string,
  ctx: Pick<BrowserHandlerContext, "sessionManager" | "sendTo">,
): void {
  const { sessionManager, sendTo } = ctx;
  const session = sessionManager.get(sessionId);
  if (!session) return;
  if (session.uiModules && session.uiModules.length > 0) {
    sendTo(ws, { type: "ui_modules_list", sessionId, modules: session.uiModules } as any);
  }
  if (session.uiDataMap) {
    for (const [event, items] of Object.entries(session.uiDataMap)) {
      sendTo(ws, { type: "ui_data_list", sessionId, event, items } as any);
    }
  }
  if (session.uiDecorators) {
    for (const descriptor of Object.values(session.uiDecorators)) {
      sendTo(ws, { type: "ext_ui_decorator", sessionId, descriptor } as any);
    }
  }

  // Replay cached plugin intents for this session (per-session AND global).
  // See change: adopt-server-driven-intent-rendering.
  for (const entry of pluginIntentCache.getForSession(sessionId)) {
    sendTo(ws, {
      type: "plugin_intents",
      pluginId: entry.pluginId,
      sessionId: entry.sessionId,
      slot: entry.slot,
      intent: entry.intent,
    } as any);
  }
  // Also replay global (sessionId === null) intents.
  for (const entry of pluginIntentCache.getForSession(null)) {
    sendTo(ws, {
      type: "plugin_intents",
      pluginId: entry.pluginId,
      sessionId: null,
      slot: entry.slot,
      intent: entry.intent,
    } as any);
  }
}

/**
 * Replay the per-session image asset registry to a single browser. Sends one
 * `asset_register` message per `(hash, { data, mimeType })` entry in
 * `Session.assets`. Called BEFORE `sendEventBatches` so any `pi-asset:<hash>`
 * tokens in replayed `message_update` / `message_end` events have their
 * referent in the client's session map by the time they're reduced.
 *
 * See change: chat-markdown-local-images-and-math.
 */
export function replaySessionAssets(
  ws: WebSocket,
  sessionId: string,
  ctx: Pick<BrowserHandlerContext, "sessionManager" | "sendTo">,
): void {
  const { sessionManager, sendTo } = ctx;
  const session = sessionManager.get(sessionId);
  if (!session?.assets) return;
  for (const [hash, asset] of Object.entries(session.assets)) {
    if (!asset || typeof asset.data !== "string" || typeof asset.mimeType !== "string") continue;
    sendTo(ws, {
      type: "asset_register",
      sessionId,
      hash,
      mimeType: asset.mimeType,
      data: asset.data,
    } as any);
  }
}

/**
 * Serve one `history_backfill`. Reads ONLY the in-memory store — never the
 * session file on disk (serving backfill from disk is an explicit Non-Goal).
 *
 * EXACTLY ONE `history_backfill_result` leaves this function on every path,
 * including every refusal. A dropped request would strand the client with a
 * pending divider and no retry path.
 * See change: lazy-load-session-history (D6, D7, D9).
 */
export async function handleHistoryBackfill(
  msg: Extract<BrowserToServerMessage, { type: "history_backfill" }>,
  subs: Set<string>,
  ctx: BrowserHandlerContext,
): Promise<void> {
  const { ws, eventStore, sendTo } = ctx;
  const sessionId = msg.sessionId;
  const refuse = (error: NonNullable<HistoryBackfillResultMessage["error"]>): void => {
    sendTo(ws, {
      type: "history_backfill_result",
      sessionId,
      events: [],
      servedFrom: 0,
      servedTo: 0,
      remainingGapCount: 0,
      error,
    });
  };

  // Refuse an unsubscribed session WITHOUT touching the store.
  if (!subs.has(sessionId)) return refuse("not_subscribed");
  const gap = gapMapFor(ws).get(sessionId);
  if (!gap || gap.tailMinSeq <= 0) return refuse("out_of_range");
  // Single-flight: a second request is REFUSED, not queued, so scroll-spam
  // cannot stack serialize+send work.
  if (gap.inFlight) return refuse("in_flight");

  const requestedFrom = Math.floor(msg.fromSeq);
  const requestedTo = Math.floor(msg.toSeq);
  if (!Number.isFinite(requestedFrom) || !Number.isFinite(requestedTo) || requestedTo < requestedFrom) {
    return refuse("out_of_range");
  }
  // Clamp into the gap the client was actually told about.
  let from = Math.max(requestedFrom, gap.headMaxSeq + 1);
  let to = Math.min(requestedTo, gap.tailMinSeq - 1);
  if (to < from) return refuse("out_of_range");
  /**
   * Request ORIENTATION, decided on the gap-clamped bounds and BEFORE the span
   * clamp. It selects both the edge to snap and the bound the span clamp may
   * move.
   *
   * The span clamp must move the NON-abutting bound. Lowering `to` on a
   * tail-adjacent request would destroy the very adjacency the response is
   * credited for: the server would credit nothing while the client still
   * retreats its own `tailMinSeq`, the two views diverge, and the next derived
   * range inverts into a permanent `out_of_range` loop.
   * See change: fix-lazy-history-backfill-ux (D4, D4a).
   */
  const tailAnchored = to === gap.tailMinSeq - 1;
  // Clamp the SPAN last, so a clamp into the gap can never re-inflate it.
  if (to - from + 1 > BACKFILL_MAX_SPAN) {
    if (tailAnchored) from = to - BACKFILL_MAX_SPAN + 1;
    else to = from + BACKFILL_MAX_SPAN - 1;
  }

  const generation = gap.generation;
  gap.inFlight = true;
  try {
    const raw = eventStore.getEventsRange(sessionId, from, to);
    /**
     * Snap the slice's GAP-FACING edge — the lower edge for a tail-anchored
     * request, the upper edge for a head-anchored one. Orientation, not a
     * hardcoded side, so a legacy head-first client stays correct.
     *
     * The value is not "this slice has no orphan": within `[from, to]` a
     * dangling `tool_execution_start`'s end is always ABOVE `to`, so the lower
     * cut can only ever produce orphan ENDS. What a clean lower cut buys is the
     * NEXT slice's top seam, which is exactly this cut minus one.
     *
     * A snap may only SHRINK, and never to empty: an empty `events` array is
     * the client's termination signal, so an over-eager snap would silently
     * strand the gap. No boundary within `SNAP_LOOKUP` → serve the raw cut.
     * See change: fix-lazy-history-backfill-ux (D4).
     */
    let slice = raw;
    let servedFrom = from;
    let servedTo = to;
    if (raw.length > 1) {
      if (tailAnchored) {
        const cut = snapLowerEdgeForward(raw, 0);
        if (cut > 0 && cut < raw.length) {
          slice = raw.slice(cut);
          servedFrom = slice[0].seq;
        }
      } else {
        const cut = snapUpperEdgeBack(raw, raw.length);
        if (cut > 0 && cut < raw.length) {
          slice = raw.slice(0, cut);
          servedTo = slice[slice.length - 1].seq;
        }
      }
    }
    // Yield once before responding. The generation is re-checked AFTER this
    // point, which is what makes an unsubscribe/re-subscribe racing a backfill
    // observable rather than a silent overlap.
    await new Promise<void>((r) => setImmediate(r));

    const current = gapMapFor(ws).get(sessionId);
    if (!subs.has(sessionId) || !current || current.generation !== generation) {
      return refuse("stale_generation");
    }

    // Compact against the FULL stream's supersession boundary (D7). For a gap
    // slice a later `message_end` ALWAYS exists outside it (in the tail), so
    // the entire slice is superseded: pass `slice.length`. Deriving the
    // boundary from the slice would keep updates whose `message_end` lives in
    // the already-delivered tail, rendering stale snapshots over a closed
    // message; skipping compaction is strictly worse still — the store retains
    // every cumulative snapshot, so an un-compacted slice serves ALL of them.
    const compacted = compactEventsForReplay(slice, slice.length);

    /**
     * Credit the abutting edge, from the POST-SNAP served bounds. The gap is
     * symmetric: a tail-adjacent range retreats `tailMinSeq`, a head-adjacent
     * one advances `headMaxSeq`. This is what terminates the client's loop.
     *
     * ONLY when the served range genuinely abuts. The bounds are clamped INTO
     * the gap, so a client is free to ask for a range floating in its middle;
     * moving an edge past a range that was never served would permanently
     * orphan everything beyond it, with the client's own stop rule none the
     * wiser. The server must not trust the client to walk from an edge.
     *
     * Crediting is EXCLUSIVE and the final short request can abut both edges at
     * once, so the order is a real decision: credit the TAIL, keeping one
     * consistent direction of travel.
     * See change: fix-lazy-history-backfill-ux (D1, D1a, D4).
     */
    const tailAdjacent = servedTo === current.tailMinSeq - 1;
    const headAdjacent = servedFrom === current.headMaxSeq + 1;
    if (tailAdjacent) current.tailMinSeq = servedFrom;
    else if (headAdjacent) current.headMaxSeq = servedTo;
    // Truthful count of what the store STILL HOLDS inside the gap — never the
    // seq distance, which overstates a middle-trimmed store.
    const remainingGapCount = eventStore.getEventsRange(
      sessionId,
      current.headMaxSeq + 1,
      current.tailMinSeq - 1,
    ).length;

    sendTo(ws, {
      type: "history_backfill_result",
      sessionId,
      events: compacted.map((e) => ({ seq: e.seq, event: truncateToolResultForReplay(e.event) })),
      servedFrom,
      servedTo,
      remainingGapCount,
    });
  } finally {
    const latch = gapMapFor(ws).get(sessionId);
    if (latch && latch.generation === generation) latch.inFlight = false;
  }
}

export function handleSubscribe(
  msg: Extract<BrowserToServerMessage, { type: "subscribe" }>,
  subs: Set<string>,
  ctx: BrowserHandlerContext,
): void {
  const { ws, sessionManager, eventStore, directoryService, piGateway, sendTo, broadcast, getSubscribers, replayPendingUiRequests, replayNotifyLog, markReplaying, clearReplaying } = ctx;
  // A programmatically constructed server must not silently stay unlimited:
  // fall back to the shared DEFAULT, not to 0.
  // See change: fix-lazy-history-backfill-ux (D7).
  const maxReplayEvents = ctx.maxReplayEvents ?? DEFAULT_MEMORY_LIMITS.maxReplayEvents;
  subs.add(msg.sessionId);
  // Every subscribe starts a new generation; any backfill still in flight from
  // the previous one now completes stale (D9).
  bumpSubscriptionGeneration(ws, msg.sessionId);

  // Request metadata from the extension so commands/flows/models/roles arrive
  // while the browser is actually subscribed (responses use sendToSubscribers).
  piGateway.sendToSession(msg.sessionId, { type: "request_commands", sessionId: msg.sessionId });
  piGateway.sendToSession(msg.sessionId, { type: "request_models", sessionId: msg.sessionId });
  // See change: replace-hardcoded-provider-lists.
  piGateway.sendToSession(msg.sessionId, { type: "request_providers", sessionId: msg.sessionId });
  piGateway.sendToSession(msg.sessionId, { type: "request_roles", sessionId: msg.sessionId });

  /**
   * Replay is fire-and-forget from this sync handler, so a rejection had no
   * owner. Handling it here is not just logging: `markReplaying` suppresses
   * live events for this socket, so a replay that dies mid-flight would leave
   * the session permanently muted. Clear the flag with `lastReplayedSeq = 0` —
   * no catch-up is claimable when we cannot know how far the replay got.
   * See change: cleanup-async-semantics-server-extension (design D1).
   */
  const onReplayFailed = (err: unknown): void => {
    clearReplaying(ws, msg.sessionId, 0);
    console.error(`[replay] event replay failed for ${msg.sessionId}:`, err);
  };

  if (eventStore.hasEvents(msg.sessionId)) {
    const lastSeq = msg.lastSeq ?? 0;
    const maxSeq = eventStore.getMaxSeq(msg.sessionId);

    // Stale lastSeq: client has higher seq than server (e.g. server restarted)
    if (lastSeq > 0 && lastSeq > maxSeq) {
      sendTo(ws, { type: "session_state_reset", sessionId: msg.sessionId });
      // Full replay from seq 1
      const events = eventStore.getEvents(msg.sessionId, 1);
      // Replay asset registry BEFORE events so pi-asset:<hash> tokens in
      // message_update / message_end resolve on first reduce.
      // See change: chat-markdown-local-images-and-math.
      replaySessionAssets(ws, msg.sessionId, ctx);
      markReplaying(ws, msg.sessionId);
      // Stale lastSeq is ALWAYS a full stream — window it (D1).
      sendEventBatches(ws, msg.sessionId, events, sendTo, maxReplayEvents)
        .then((lastSent) => {
          clearReplaying(ws, msg.sessionId, lastSent);
          replayPendingUiRequests(ws, msg.sessionId);
          replayNotifyLog(ws, msg.sessionId);
          replayUiState(ws, msg.sessionId, ctx);
        })
        .catch(onReplayFailed);
    } else {
      const events = eventStore.getEvents(msg.sessionId, lastSeq + 1);
      /**
       * This branch is DUAL-PURPOSE: `lastSeq = msg.lastSeq ?? 0`, so a browser
       * reload with no cached seq against a still-warm server lands here with
       * `getEvents(sessionId, 1)` — the entire stream. Windowing is therefore
       * keyed on CONTENT (is this a full stream?), never on call site: keying
       * on the site would make `maxReplayEvents` a no-op for warm reloads, the
       * dominant reopen path and the primary case this change targets.
       *
       * A genuine delta (`lastSeq > 0`) is never windowed — that would punch a
       * seq gap between what the client holds and what it receives.
       * See change: lazy-load-session-history (D1).
       */
      const fullStreamLimit = lastSeq === 0 ? maxReplayEvents : 0;
      /**
       * This path does NOT otherwise send `session_state_reset` — it relies on
       * the reducer's `firstSeq === 1` rule. A windowed replay must not depend
       * on that store invariant, so reset explicitly before one.
       * See change: lazy-load-session-history (D5).
       */
      if (fullStreamLimit > 0 && events.length > fullStreamLimit) {
        sendTo(ws, { type: "session_state_reset", sessionId: msg.sessionId });
      }
      // Replay asset registry on every subscribe (delta or full). Cheap when
      // empty; assets already known to the client are simply re-overwritten
      // with identical bytes. See change: chat-markdown-local-images-and-math.
      replaySessionAssets(ws, msg.sessionId, ctx);
      // Suppress live events during paginated replay to prevent out-of-order
      // delivery. The client's `event_replay` reset rule (firstSeq <= maxSeq)
      // misfires if a live `event` arrives between batches and bumps maxSeq
      // past the next batch's firstSeq — wiping state to a fresh build of
      // only the last batch. Suppression+catch-up via clearReplaying preserves
      // ordering for both cold (lastSeq=0) and warm (lastSeq>0) subscribes.
      // See change: fix-cold-subscribe-replay-interleave.
      if (events.length > 0) {
        markReplaying(ws, msg.sessionId);
        sendEventBatches(ws, msg.sessionId, events, sendTo, fullStreamLimit)
          .then((lastSent) => {
            clearReplaying(ws, msg.sessionId, lastSent);
            replayPendingUiRequests(ws, msg.sessionId);
            replayNotifyLog(ws, msg.sessionId);
            replayUiState(ws, msg.sessionId, ctx);
          })
          .catch(onReplayFailed);
      } else {
        sendEventBatches(ws, msg.sessionId, events, sendTo)
          .then(() => {
            replayPendingUiRequests(ws, msg.sessionId);
            replayNotifyLog(ws, msg.sessionId);
            replayUiState(ws, msg.sessionId, ctx);
          })
          .catch(onReplayFailed);
      }
    }
  } else if (directoryService) {
    const session = sessionManager.get(msg.sessionId);
    if (session?.sessionFile) {
      sendTo(ws, {
        type: "event_replay",
        sessionId: msg.sessionId,
        events: [],
        isLast: false,
      });
      // Hydration heartbeat: re-emit the empty non-terminal marker to every live
      // subscriber while the disk parse is in flight, so a parse longer than the
      // client's hydration ceiling does not surface a false empty state. Stopped
      // in every exit path of the load promise via `stopHeartbeat`.
      // See change: fix-history-loading-false-empty-flash.
      let heartbeat: ReturnType<typeof setInterval> | null = setInterval(() => {
        for (const sub of getSubscribers(msg.sessionId)) {
          if (sub.readyState === sub.OPEN) {
            sendTo(sub, { type: "event_replay", sessionId: msg.sessionId, events: [], isLast: false });
          }
        }
      }, HYDRATE_HEARTBEAT_MS);
      const stopHeartbeat = () => {
        if (heartbeat !== null) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      };
      directoryService.loadSessionEvents(msg.sessionId, session.sessionFile, session.contextWindow).then(async (result) => {
        stopHeartbeat();
        if (result.success) {
          // Hydration admits full-resolution inline images straight from the
          // transcript, so it needs the SAME two-phase strip as the live path.
          // Without it a reload resurrects the original bug: the event blows
          // the per-event ceiling, collapses to {__truncated}, and the user's
          // message row disappears on every replay.
          // See change: fit-attachments-for-display (task 5.2, test-plan #E9).
          const pendingAttachments: PendingAttachment[] = [];
          for (const evt of result.events) {
            // Strip UNCONDITIONALLY. Gating this on the pool meant a host
            // without one hydrated full-resolution events — the exact bug the
            // comment above describes. The bound must not depend on whether a
            // fitter happens to be configured; placeholders are settled below
            // either way.
            const prepared = prepareEventForIngest(evt);
            pendingAttachments.push(...prepared.pending);
            eventStore.insertEvent(msg.sessionId, prepared.event);
          }
          const statsUpdates = extractStatsFromEvents(result.events);
          const metaUpdates: Record<string, unknown> = { dataUnavailable: false, ...statsUpdates };
          sessionManager.update(msg.sessionId, metaUpdates);
          broadcast({ type: "session_updated", sessionId: msg.sessionId, updates: metaUpdates });
          const stored = eventStore.getEvents(msg.sessionId, 1);
          const subscribers = getSubscribers(msg.sessionId);
          for (const sub of subscribers) {
            // Asset registry first — see change: chat-markdown-local-images-and-math.
            replaySessionAssets(sub, msg.sessionId, ctx);
            // Cold hydration is ALWAYS a full stream — window it (D1). The
            // `history_window` message is emitted per subscriber inside this
            // loop by `sendEventBatches` itself.
            await sendEventBatches(sub, msg.sessionId, stored, sendTo, maxReplayEvents);
            replayPendingUiRequests(sub, msg.sessionId);
            replayNotifyLog(sub, msg.sessionId);
            replayUiState(sub, msg.sessionId, ctx);
          }
          // Fit AFTER the batches are on the wire: the rows (with their
          // placeholders) render immediately and each image swaps in as its
          // derivative lands, so hydration is never blocked on a resize.
          // Detached — a fit failure can only degrade an attachment.
          if (pendingAttachments.length > 0) {
            // With no pool, stand in one that answers nothing: the resolver
            // settles every unanswered placeholder to an explicit failed state,
            // so a row can never keep a placeholder that no one will resolve.
            const pool = ctx.fitWorkerPool ?? {
              fit: async () => ({ jobId: 0, results: [] }),
              dispose: async () => {},
              inFlight: () => 0,
            };
            void createAttachmentResolver({
              eventStore,
              fitWorkerPool: pool,
              emit: (sessionId, seq, event) => {
                for (const sub of getSubscribers(sessionId)) {
                  if (sub.readyState === sub.OPEN) {
                    sendTo(sub, { type: "event", sessionId, seq, event });
                  }
                }
              },
            })
              .resolve(msg.sessionId, pendingAttachments)
              // Detached: `resolve` guards the fit, but not its publish calls.
              // An escaping rejection here would be unhandled and take the
              // process down, so hydration degrades the attachment instead.
              .catch((err) => {
                console.error(`[attachments] hydration resolve failed for ${msg.sessionId}:`, err);
              });
          }
        } else if (result.error === "cancelled") {
          // The load was cancelled because the subscriber left before it
          // resolved. Do NOT mark the session dataUnavailable or replay to a
          // gone ws — the session is fine, the work was just abandoned.
          // See change: offload-session-events-load-to-worker.
        } else {
          sendTo(ws, { type: "event_replay", sessionId: msg.sessionId, events: [], isLast: true });
          sessionManager.update(msg.sessionId, { dataUnavailable: true });
          broadcast({ type: "session_updated", sessionId: msg.sessionId, updates: { dataUnavailable: true } });
        }
      }).catch(() => {
        stopHeartbeat();
        sendTo(ws, { type: "event_replay", sessionId: msg.sessionId, events: [], isLast: true });
        sessionManager.update(msg.sessionId, { dataUnavailable: true });
        broadcast({ type: "session_updated", sessionId: msg.sessionId, updates: { dataUnavailable: true } });
      });
    } else {
      sendTo(ws, { type: "event_replay", sessionId: msg.sessionId, events: [], isLast: true });
      if (session) {
        sessionManager.update(msg.sessionId, { dataUnavailable: true });
        broadcast({ type: "session_updated", sessionId: msg.sessionId, updates: { dataUnavailable: true } });
      }
    }
  } else {
    sendTo(ws, { type: "event_replay", sessionId: msg.sessionId, events: [], isLast: true });
  }
}
