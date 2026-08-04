/**
 * Subscription message handlers: subscribe, unsubscribe.
 */

import type { BrowserToServerMessage, ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { WebSocket } from "ws";
import type { DirectoryService } from "../directory-service.js";
import { extractStatsFromEvents } from "../session/event-status-extraction.js";
import type { StoredEvent } from "../persistence/memory-event-store.js";
import { pluginIntentCache } from "../plugin-intent-cache.js";
import { compactEventsForReplay } from "../session/replay-compaction.js";
import { truncateToolResultForReplay } from "../session/replay-truncate.js";
import type { BrowserHandlerContext } from "./handler-context.js";
import { selectWindow, TAIL_WINDOW_EVENTS } from "./select-window.js";

/**
 * In-flight cold-load buffer fills, keyed by sessionId. A `load_older` that
 * arrives while a session's full event list is still being inserted into the
 * store awaits this promise so it answers from the fully populated buffer.
 * See change: tail-first-session-loading.
 */
const coldFillPromises = new Map<string, Promise<void>>();

/**
 * Raised 50 → 200. Each batch is one client React commit, so a large warm
 * window used to cost hundreds of commits. With `compactEventsForReplay`
 * removing the superseded snapshot updates, a 200-event batch stays well under
 * BACKPRESSURE_THRESHOLD. See change: compact-warm-replay-stream (D5).
 */
const REPLAY_BATCH_SIZE = 200;
/** Max events to replay per session subscription (0 = unlimited) */
const MAX_REPLAY_EVENTS = 0;
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
 * Send stored events to a WebSocket in batches with backpressure handling.
 * Yields between batches to let the event loop flush data and avoid OOM.
 */
/**
 * Send stored events to a WebSocket in batches with backpressure handling.
 *
 * Returns the PRE-compaction highest seq of the window, or 0 if nothing was
 * sent. Compaction can drop the highest-seq event (a still-superseded
 * `message_update`); returning the last SURVIVING seq would make
 * `clearReplaying` re-send already-covered events as a catch-up batch.
 * See change: compact-warm-replay-stream (D4).
 *
 * Exported so unit tests can drive the batching / backpressure / socket-close
 * paths directly, mirroring `replayUiState` / `replaySessionAssets`.
 */
export async function sendEventBatches(
  ws: WebSocket,
  sessionId: string,
  stored: StoredEvent[],
  sendTo: (ws: WebSocket, msg: ServerToBrowserMessage) => void,
  opts?: { kind?: "tail" | "older" | "delta"; hasOlder?: boolean },
): Promise<number> {
  // High-water mark is computed from the PRE-compaction window (D4).
  const preCompactionMaxSeq = stored.length > 0 ? stored[stored.length - 1].seq : 0;
  // Replay-only stream compaction: drop assistant `message_update` snapshots
  // superseded by a later `message_end`, bringing the warm (in-memory) window
  // down to the cold (on-disk) path's shape. The store keeps the full stream.
  // See change: compact-warm-replay-stream.
  const compacted = compactEventsForReplay(stored);
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
      // Tail-first window metadata (change: tail-first-session-loading). Rides
      // on every batch of the window; the client resets on the first `tail`
      // batch and reads `hasOlder` to gate scroll-up pagination.
      ...(opts?.kind ? { kind: opts.kind } : {}),
      ...(opts?.hasOlder !== undefined ? { hasOlder: opts.hasOlder } : {}),
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

export function handleSubscribe(
  msg: Extract<BrowserToServerMessage, { type: "subscribe" }>,
  subs: Set<string>,
  ctx: BrowserHandlerContext,
): void {
  const { ws, sessionManager, eventStore, directoryService, piGateway, sendTo, broadcast, getSubscribers, replayPendingUiRequests, markReplaying, clearReplaying } = ctx;
  subs.add(msg.sessionId);

  // Request metadata from the extension so commands/flows/models/roles arrive
  // while the browser is actually subscribed (responses use sendToSubscribers).
  piGateway.sendToSession(msg.sessionId, { type: "request_commands", sessionId: msg.sessionId });
  piGateway.sendToSession(msg.sessionId, { type: "request_models", sessionId: msg.sessionId });
  // See change: replace-hardcoded-provider-lists.
  piGateway.sendToSession(msg.sessionId, { type: "request_providers", sessionId: msg.sessionId });
  piGateway.sendToSession(msg.sessionId, { type: "request_roles", sessionId: msg.sessionId });

  if (eventStore.hasEvents(msg.sessionId)) {
    const lastSeq = msg.lastSeq ?? 0;
    const maxSeq = eventStore.getMaxSeq(msg.sessionId);

    // Stale lastSeq: client has higher seq than server (e.g. server restarted).
    // Reply session_state_reset + the TAIL window (not a full replay from seq
    // 1) — strictly less traffic, same correctness: the client refetches older
    // history lazily via load_older. See change: tail-first-session-loading.
    if (lastSeq > 0 && lastSeq > maxSeq) {
      sendTo(ws, { type: "session_state_reset", sessionId: msg.sessionId });
      const all = eventStore.getEvents(msg.sessionId, 1);
      const { events: window, hasOlder } = selectWindow(all, undefined, TAIL_WINDOW_EVENTS);
      // Replay asset registry BEFORE events so pi-asset:<hash> tokens in
      // message_update / message_end resolve on first reduce.
      // See change: chat-markdown-local-images-and-math.
      replaySessionAssets(ws, msg.sessionId, ctx);
      markReplaying(ws, msg.sessionId);
      sendEventBatches(ws, msg.sessionId, window, sendTo, { kind: "tail", hasOlder }).then((lastSent) => {
        clearReplaying(ws, msg.sessionId, lastSent);
        replayPendingUiRequests(ws, msg.sessionId);
        replayUiState(ws, msg.sessionId, ctx);
      });
    } else if (lastSeq === 0) {
      // Cold/warm full subscribe: send ONLY the newest tail window. Older
      // history streams lazily via load_older. Suppression now covers only
      // this bounded window, not the whole history.
      // See change: tail-first-session-loading.
      const all = eventStore.getEvents(msg.sessionId, 1);
      const { events: window, hasOlder } = selectWindow(all, undefined, TAIL_WINDOW_EVENTS);
      replaySessionAssets(ws, msg.sessionId, ctx);
      if (window.length > 0) {
        markReplaying(ws, msg.sessionId);
        sendEventBatches(ws, msg.sessionId, window, sendTo, { kind: "tail", hasOlder }).then((lastSent) => {
          clearReplaying(ws, msg.sessionId, lastSent);
          replayPendingUiRequests(ws, msg.sessionId);
          replayUiState(ws, msg.sessionId, ctx);
        });
      } else {
        sendEventBatches(ws, msg.sessionId, window, sendTo, { kind: "tail", hasOlder }).then(() => {
          replayPendingUiRequests(ws, msg.sessionId);
          replayUiState(ws, msg.sessionId, ctx);
        });
      }
    } else {
      // Warm delta subscribe (lastSeq > 0, within range): unchanged semantics —
      // replay events after the cursor with kind:"delta".
      let events = eventStore.getEvents(msg.sessionId, lastSeq + 1);
      if (MAX_REPLAY_EVENTS > 0 && events.length > MAX_REPLAY_EVENTS) {
        events = events.slice(events.length - MAX_REPLAY_EVENTS);
      }
      // No `hasOlder` on delta: the server does not know the client's oldest
      // buffered seq (only its `lastSeq` cursor), so the client derives
      // scroll-up availability from its own rehydrated buffer (oldestSeq > 1)
      // and the authoritative load_older responses. See change:
      // tail-first-session-loading (D7).
      replaySessionAssets(ws, msg.sessionId, ctx);
      // Suppress live events during paginated replay to prevent out-of-order
      // delivery. See change: fix-cold-subscribe-replay-interleave.
      if (events.length > 0) {
        markReplaying(ws, msg.sessionId);
        sendEventBatches(ws, msg.sessionId, events, sendTo, { kind: "delta" }).then((lastSent) => {
          clearReplaying(ws, msg.sessionId, lastSent);
          replayPendingUiRequests(ws, msg.sessionId);
          replayUiState(ws, msg.sessionId, ctx);
        });
      } else {
        sendEventBatches(ws, msg.sessionId, events, sendTo, { kind: "delta" }).then(() => {
          replayPendingUiRequests(ws, msg.sessionId);
          replayUiState(ws, msg.sessionId, ctx);
        });
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
          // Tail-first delivery (change: tail-first-session-loading): send the
          // tail window to all waiting subscribers as soon as conversion
          // resolves, WITHOUT waiting for the full list to be inserted into the
          // in-memory buffer. Seq numbers are assigned densely from 1 in
          // arrival order, matching the store's insert order below.
          const converted: StoredEvent[] = result.events.map((event, i) => ({ seq: i + 1, event }));
          const { events: window, hasOlder } = selectWindow(converted, undefined, TAIL_WINDOW_EVENTS);

          // Header stats ride the FULL list, not the window, so token/context
          // surfaces don't regress to window-local values. See change:
          // tail-first-session-loading (on-demand-session-replay).
          const statsUpdates = extractStatsFromEvents(result.events);
          const metaUpdates: Record<string, unknown> = { dataUnavailable: false, ...statsUpdates };
          sessionManager.update(msg.sessionId, metaUpdates);
          broadcast({ type: "session_updated", sessionId: msg.sessionId, updates: metaUpdates });

          // Fill the in-memory buffer with the FULL list in yielding chunks so
          // a 40 MB session's insert doesn't block the event loop. Register the
          // fill promise BEFORE the tail-send loop so a `load_older` arriving
          // during tail delivery awaits the fill instead of racing an empty
          // store and getting a false end-of-history (hasOlder:false). See
          // change: tail-first-session-loading.
          const fill = fillEventStoreChunked(eventStore, msg.sessionId, result.events);
          coldFillPromises.set(msg.sessionId, fill);
          fill.finally(() => {
            if (coldFillPromises.get(msg.sessionId) === fill) {
              coldFillPromises.delete(msg.sessionId);
            }
          });

          const subscribers = getSubscribers(msg.sessionId);
          for (const sub of subscribers) {
            // Asset registry first — see change: chat-markdown-local-images-and-math.
            replaySessionAssets(sub, msg.sessionId, ctx);
            await sendEventBatches(sub, msg.sessionId, window, sendTo, { kind: "tail", hasOlder });
            replayPendingUiRequests(sub, msg.sessionId);
            replayUiState(sub, msg.sessionId, ctx);
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

/** Bounded slice size for the yielding cold-load buffer fill. */
const COLD_FILL_CHUNK = 500;

/**
 * Insert `events` into the store in bounded slices, yielding to the event loop
 * between chunks so inserting a large session (tens of MB) does not block the
 * server. Resolves when the whole list is inserted. See change:
 * tail-first-session-loading.
 */
export function fillEventStoreChunked(
  eventStore: BrowserHandlerContext["eventStore"],
  sessionId: string,
  events: import("@blackbelt-technology/pi-dashboard-shared/types.js").DashboardEvent[],
): Promise<void> {
  return new Promise<void>((resolve) => {
    let i = 0;
    const step = () => {
      const end = Math.min(i + COLD_FILL_CHUNK, events.length);
      for (; i < end; i++) {
        eventStore.insertEvent(sessionId, events[i]);
      }
      if (i >= events.length) {
        resolve();
        return;
      }
      setImmediate(step);
    };
    step();
  });
}

/**
 * Start one full on-disk history fill for a session that has only a bounded
 * bridge reattach tail in memory. The bridge tail renders immediately; this
 * fill makes older `load_older` pages reachable once the worker finishes.
 *
 * The returned promise resolves true only when this call started and completed
 * a replacement fill. `undefined` means an existing cold fill already owns the
 * session, so its caller must not issue a duplicate reset/replay.
 */
export function beginReattachHistoryHydration(
  eventStore: BrowserHandlerContext["eventStore"],
  directoryService: DirectoryService,
  sessionId: string,
  sessionFile: string,
  knownContextWindow?: number,
): Promise<boolean> | undefined {
  if (coldFillPromises.has(sessionId)) return undefined;
  // replay_complete guarantees the bounded bridge tail is fully inserted.
  // Every later event in this buffer arrived live while the worker parsed.
  const bridgeTailCount = eventStore.getEvents(sessionId, 1).length;

  const result = directoryService
    .loadSessionEvents(sessionId, sessionFile, knownContextWindow)
    .then(async (loaded) => {
      if (!loaded.success || loaded.events.length === 0) return false;
      // Do not erase the bridge tail until the full JSONL conversion has
      // succeeded. A failed worker load leaves the usable recent tail intact.
      const liveEvents = eventStore
        .getEvents(sessionId, 1)
        .slice(bridgeTailCount)
        .map((entry) => entry.event);
      // One synchronous replacement means live bridge frames cannot interleave
      // between yielding history chunks. `liveEvents` was captured after the
      // bridge-tail baseline, so it appends after canonical JSONL history.
      eventStore.replaceEvents(sessionId, [...loaded.events, ...liveEvents]);
      return true;
    })
    .catch(() => false);
  const fill = result.then(() => undefined);
  coldFillPromises.set(sessionId, fill);
  fill.finally(() => {
    if (coldFillPromises.get(sessionId) === fill) {
      coldFillPromises.delete(sessionId);
    }
  });
  return result;
}

/**
 * Handle a `load_older` scroll-up pagination request. Replies with a single
 * `event_replay { kind: "older", … }` covering the previous window (seqs
 * `< beforeSeq`), selected with the same budget-and-safe-cut rule as the tail.
 * Sent OUTSIDE the replaying bookkeeping so live events keep flowing; the
 * client never advances `maxSeq` from `kind: "older"` events. Awaits an
 * in-flight cold-load buffer fill so it answers from the fully populated store.
 * See change: tail-first-session-loading.
 */
export async function handleLoadOlder(
  msg: Extract<BrowserToServerMessage, { type: "load_older" }>,
  ctx: BrowserHandlerContext,
): Promise<void> {
  const { ws, eventStore, sendTo } = ctx;

  // Validate the attacker-controllable cursor before it reaches selectWindow.
  // A non-finite / ≤ 0 beforeSeq would otherwise slice unbounded history (NaN
  // filter → empty; huge → full tail) and serialize it over the WS — a
  // memory/CPU DoS that defeats the bounding goal. See change:
  // tail-first-session-loading (doubt: security).
  if (!Number.isFinite(msg.beforeSeq) || msg.beforeSeq <= 1) {
    sendTo(ws, {
      type: "event_replay",
      sessionId: msg.sessionId,
      events: [],
      isLast: true,
      kind: "older",
      hasOlder: false,
    });
    return;
  }

  // If a cold-load fill is inflight for this session, answer after it completes
  // so the older window is selected from the fully populated buffer.
  const fill = coldFillPromises.get(msg.sessionId);
  if (fill) await fill;

  if (!eventStore.hasEvents(msg.sessionId)) {
    // Unavailable session (evicted, never loaded, or load failed) — degrade
    // safely: signal end-of-history so the client stops paginating.
    sendTo(ws, {
      type: "event_replay",
      sessionId: msg.sessionId,
      events: [],
      isLast: true,
      kind: "older",
      hasOlder: false,
    });
    return;
  }

  const all = eventStore.getEvents(msg.sessionId, 1);
  // Clamp the budget: a client-supplied `limit` may not exceed the hard cap, so
  // one request can never pull more than 2× the window. See change:
  // tail-first-session-loading (doubt: security).
  const budget =
    msg.limit && Number.isFinite(msg.limit) && msg.limit > 0
      ? Math.min(msg.limit, 2 * TAIL_WINDOW_EVENTS)
      : TAIL_WINDOW_EVENTS;
  const { events: window, hasOlder } = selectWindow(all, msg.beforeSeq, budget);
  sendTo(ws, {
    type: "event_replay",
    sessionId: msg.sessionId,
    events: window.map((e) => ({ seq: e.seq, event: truncateToolResultForReplay(e.event) })),
    isLast: true,
    kind: "older",
    hasOlder,
  });
}
