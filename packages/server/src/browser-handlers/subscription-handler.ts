/**
 * Subscription message handlers: subscribe, unsubscribe.
 */
import type { WebSocket } from "ws";
import type { ServerToBrowserMessage, BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { BrowserHandlerContext } from "./handler-context.js";
import { extractStatsFromEvents } from "../event-status-extraction.js";
import type { StoredEvent } from "../memory-event-store.js";

const REPLAY_BATCH_SIZE = 50;
/** Max events to replay per session subscription (0 = unlimited) */
const MAX_REPLAY_EVENTS = 0;
/** Max buffered bytes before pausing replay sends (1MB) */
const BACKPRESSURE_THRESHOLD = 1_024 * 1_024;

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
      events: batch.map((e) => ({ seq: e.seq, event: e.event })),
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
  piGateway.sendToSession(msg.sessionId, { type: "request_roles", sessionId: msg.sessionId });
  piGateway.sendToSession(msg.sessionId, { type: "ui_management", sessionId: msg.sessionId, action: "list", event: "ui:list-modules" });

  // Send cached UI metadata if available
  const session = sessionManager.get(msg.sessionId);
  if (session) {
    if (session.uiModules) {
      sendTo(ws, { type: "ui_modules_list", sessionId: msg.sessionId, modules: session.uiModules });
    }
    if (session.uiCommands) {
      sendTo(ws, { type: "commands_list", sessionId: msg.sessionId, commands: session.uiCommands });
    }
    if (session.uiDataMap) {
      for (const [event, items] of Object.entries(session.uiDataMap)) {
        sendTo(ws, { type: "ui_data_list", sessionId: msg.sessionId, event, items });
      }
    }
  }

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
      markReplaying(ws, msg.sessionId);
      sendEventBatches(ws, msg.sessionId, events, sendTo).then((lastSent) => {
        clearReplaying(ws, msg.sessionId, lastSent);
        replayPendingUiRequests(ws, msg.sessionId);
      });
    } else {
      let events = eventStore.getEvents(msg.sessionId, lastSeq + 1);
      if (MAX_REPLAY_EVENTS > 0 && events.length > MAX_REPLAY_EVENTS) {
        events = events.slice(events.length - MAX_REPLAY_EVENTS);
      }
      // Suppress live events during delta replay to prevent out-of-order delivery
      if (lastSeq > 0 && events.length > 0) {
        markReplaying(ws, msg.sessionId);
        sendEventBatches(ws, msg.sessionId, events, sendTo).then((lastSent) => {
          clearReplaying(ws, msg.sessionId, lastSent);
          replayPendingUiRequests(ws, msg.sessionId);
        });
      } else {
        sendEventBatches(ws, msg.sessionId, events, sendTo).then(() => {
          replayPendingUiRequests(ws, msg.sessionId);
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
      directoryService.loadSessionEvents(msg.sessionId, session.sessionFile).then(async (result) => {
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
            await sendEventBatches(sub, msg.sessionId, stored, sendTo);
            replayPendingUiRequests(sub, msg.sessionId);
          }
        } else {
          sendTo(ws, { type: "event_replay", sessionId: msg.sessionId, events: [], isLast: true });
          sessionManager.update(msg.sessionId, { dataUnavailable: true });
          broadcast({ type: "session_updated", sessionId: msg.sessionId, updates: { dataUnavailable: true } });
        }
      }).catch(() => {
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
