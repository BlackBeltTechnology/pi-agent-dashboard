/**
 * Subscription message handlers: subscribe, unsubscribe.
 */

import type { BrowserToServerMessage, ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { WebSocket } from "ws";
import { extractStatsFromEvents } from "../session/event-status-extraction.js";
import type { StoredEvent } from "../persistence/memory-event-store.js";
import { pluginIntentCache } from "../plugin-intent-cache.js";
import { truncateToolResultForReplay } from "../session/replay-truncate.js";
import type { BrowserHandlerContext } from "./handler-context.js";

const REPLAY_BATCH_SIZE = 50;
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
 * Returns the highest seq sent, or 0 if no events were sent.
 */
async function sendEventBatches(
  ws: WebSocket,
  sessionId: string,
  stored: StoredEvent[],
  sendTo: (ws: WebSocket, msg: ServerToBrowserMessage) => void,
): Promise<number> {
  for (let i = 0; i < stored.length; i += REPLAY_BATCH_SIZE) {
    if (ws.readyState !== ws.OPEN) return 0;
    const batch = stored.slice(i, i + REPLAY_BATCH_SIZE);
    sendTo(ws, {
      type: "event_replay",
      sessionId,
      // Strategy B (reduce-session-replay-traffic): pre-truncate heavy tool
      // results to the display form to trim replay bytes. Additive — the store
      // keeps the full body for develop's "Show full output" route; small
      // results and non-tool events pass through untouched.
      events: batch.map((e) => ({ seq: e.seq, event: truncateToolResultForReplay(e.event) })),
      isLast: i + REPLAY_BATCH_SIZE >= stored.length,
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
  return stored.length > 0 ? stored[stored.length - 1].seq : 0;
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

    // Stale lastSeq: client has higher seq than server (e.g. server restarted)
    if (lastSeq > 0 && lastSeq > maxSeq) {
      sendTo(ws, { type: "session_state_reset", sessionId: msg.sessionId });
      // Full replay from seq 1
      let events = eventStore.getEvents(msg.sessionId, 1);
      if (MAX_REPLAY_EVENTS > 0 && events.length > MAX_REPLAY_EVENTS) {
        events = events.slice(events.length - MAX_REPLAY_EVENTS);
      }
      // Replay asset registry BEFORE events so pi-asset:<hash> tokens in
      // message_update / message_end resolve on first reduce.
      // See change: chat-markdown-local-images-and-math.
      replaySessionAssets(ws, msg.sessionId, ctx);
      markReplaying(ws, msg.sessionId);
      sendEventBatches(ws, msg.sessionId, events, sendTo).then((lastSent) => {
        clearReplaying(ws, msg.sessionId, lastSent);
        replayPendingUiRequests(ws, msg.sessionId);
        replayUiState(ws, msg.sessionId, ctx);
      });
    } else {
      let events = eventStore.getEvents(msg.sessionId, lastSeq + 1);
      if (MAX_REPLAY_EVENTS > 0 && events.length > MAX_REPLAY_EVENTS) {
        events = events.slice(events.length - MAX_REPLAY_EVENTS);
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
        sendEventBatches(ws, msg.sessionId, events, sendTo).then((lastSent) => {
          clearReplaying(ws, msg.sessionId, lastSent);
          replayPendingUiRequests(ws, msg.sessionId);
          replayUiState(ws, msg.sessionId, ctx);
        });
      } else {
        sendEventBatches(ws, msg.sessionId, events, sendTo).then(() => {
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
          for (const evt of result.events) {
            eventStore.insertEvent(msg.sessionId, evt);
          }
          const statsUpdates = extractStatsFromEvents(result.events);
          const metaUpdates: Record<string, unknown> = { dataUnavailable: false, ...statsUpdates };
          sessionManager.update(msg.sessionId, metaUpdates);
          broadcast({ type: "session_updated", sessionId: msg.sessionId, updates: metaUpdates });
          let stored = eventStore.getEvents(msg.sessionId, 1);
          if (MAX_REPLAY_EVENTS > 0 && stored.length > MAX_REPLAY_EVENTS) {
            stored = stored.slice(stored.length - MAX_REPLAY_EVENTS);
          }
          const subscribers = getSubscribers(msg.sessionId);
          for (const sub of subscribers) {
            // Asset registry first — see change: chat-markdown-local-images-and-math.
            replaySessionAssets(sub, msg.sessionId, ctx);
            await sendEventBatches(sub, msg.sessionId, stored, sendTo);
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
