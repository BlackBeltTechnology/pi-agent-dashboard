import { setSender as setPluginActionSender } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { BrowserToServerMessage, ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase } from "../lib/api/api-context.js";
import { appendWsTicket, getDeviceBearer, mintWsTicket } from "../lib/pairing/device-auth.js";

export type ConnectionStatus = "connected" | "connecting" | "offline" | "auth_required";

const OFFLINE_THRESHOLD = 3;

/** How many refused messages the outbox retains before evicting oldest-first. */
export const OUTBOX_CAPACITY = 100;

/**
 * How long a queued `send_prompt` survives. Strictly below the 30 000 ms
 * pending-prompt safety deadline (`usePendingPromptTimeout.ts`) so a queued
 * prompt can never flush after the UI has already declared it failed — see
 * design D3.
 */
export const OUTBOX_EXPIRY_MS = 10_000;

/**
 * What happened to a message handed to `send`. Deliberately avoids the word
 * "delivered": a write to an OPEN socket hands bytes to the OS and proves
 * nothing about receipt.
 */
export type SendVerdict =
  | { status: "handed" }
  | { status: "queued"; /** Correlates the queued message with its outbox entry. */ entryId: number }
  | { status: "rejected"; reason: "no_socket" | "send_failed" };

interface OutboxEntry {
  /** Process-unique id; the caller keys late drop reports on it, NOT on text. */
  id: number;
  msg: BrowserToServerMessage;
  /** Epoch ms after which the entry is dropped instead of flushed. */
  expiresAt: number;
}

/**
 * Notified when a queued entry is dropped WITHOUT being flushed — it expired, or
 * capacity evicted it. This is the "never transmitted" half of the delivery
 * verdict: without it a queued prompt that outlives the reconnect window is
 * dropped silently and only surfaces later as the ambiguous 30 s wording.
 * See change: stop-discarding-known-session-state.
 */
export type OutboxExpiryListener = (msg: BrowserToServerMessage, entryId: number) => void;

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  // The live socket, exposed for consumers that attach their OWN `message`
  // listener instead of routing through `onMessage` (the plugin runtime's
  // `usePluginMessage`). State, not the ref, so a (re)connect re-attaches them.
  // See change: add-browser-relay.
  const [ws, setWs] = useState<WebSocket | null>(null);
  const handlersRef = useRef<((msg: ServerToBrowserMessage) => void)[]>([]);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);
  const failCountRef = useRef(0);
  // Holds the latest `connect` so the onclose reconnect timer always re-runs
  // the current ticket-minting path (avoids capturing a stale closure).
  const connectRef = useRef<() => void>(() => {});
  // Messages refused while the socket was not OPEN. Holds ONLY never-sent
  // messages; a handed-off message is never retained (see design D3).
  const outboxRef = useRef<OutboxEntry[]>([]);
  // Listeners told when a queued entry is dropped undelivered (expiry/eviction).
  const expiryListenersRef = useRef<OutboxExpiryListener[]>([]);
  // One timer per expiring entry; entry identity decides whether it is still
  // queued when the timer fires (a flushed entry no-ops).
  const expiryTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  // Monotonic id source for outbox entries (never reused, never persisted).
  const nextEntryIdRef = useRef(1);

  const notifyUndelivered = useCallback((entry: OutboxEntry) => {
    for (const listener of expiryListenersRef.current) {
      try {
        listener(entry.msg, entry.id);
      } catch {
        // A listener must never break the sweep.
      }
    }
  }, []);

  /**
   * Arm a drop timer for a queued entry. The callback removes the entry only if
   * it is STILL in the outbox — a flushed entry was already popped, so it must
   * not be reported as undelivered.
   */
  const scheduleEntryExpiry = useCallback(
    (entry: OutboxEntry) => {
      if (entry.expiresAt === Number.POSITIVE_INFINITY) return;
      const timer = setTimeout(() => {
        expiryTimersRef.current.delete(timer);
        const idx = outboxRef.current.indexOf(entry);
        if (idx === -1) return;
        outboxRef.current.splice(idx, 1);
        notifyUndelivered(entry);
      }, Math.max(0, entry.expiresAt - Date.now()));
      expiryTimersRef.current.add(timer);
    },
    [notifyUndelivered],
  );

  /** Subscribe to undelivered-entry notifications. Returns an unsubscriber. */
  const onOutboxExpiry = useCallback((listener: OutboxExpiryListener) => {
    expiryListenersRef.current.push(listener);
    return () => {
      expiryListenersRef.current = expiryListenersRef.current.filter((l) => l !== listener);
    };
  }, []);

  // Flush refused messages on (re)connect. The outbox is cleared BEFORE the
  // writes so a write that throws can never leave an entry to be re-sent —
  // `send_prompt` is forwarded straight to the bridge and is not idempotent.
  const flushOutbox = useCallback(
    (socket: WebSocket) => {
      const pending = outboxRef.current;
      if (pending.length === 0) return;
      outboxRef.current = [];
      const now = Date.now();
      for (const entry of pending) {
        if (entry.expiresAt <= now) {
          // Expired in the same tick the socket reopened — never transmitted, so
          // say so rather than dropping it silently.
          notifyUndelivered(entry);
          continue;
        }
        if (socket.readyState !== WebSocket.OPEN) {
          // The socket closed mid-flush; the entry was popped and not written.
          notifyUndelivered(entry);
          continue;
        }
        try {
          socket.send(JSON.stringify(entry.msg));
        } catch {
          // A failed flush is a rejected message, never a retry.
          notifyUndelivered(entry);
        }
      }
    },
    [notifyUndelivered],
  );

  const openSocket = useCallback((finalUrl: string) => {
    try {
      const ws = new WebSocket(finalUrl);
      wsRef.current = ws;
      setWs(ws);

      ws.onopen = () => {
        setStatus("connected");
        backoffRef.current = 1000;
        failCountRef.current = 0;
        flushOutbox(ws);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as ServerToBrowserMessage;
          for (const handler of handlersRef.current) {
            handler(msg);
          }
        } catch {
          // Ignore malformed
        }
      };

      ws.onclose = () => {
        setWs(null);
        failCountRef.current++;
        if (failCountRef.current >= OFFLINE_THRESHOLD) {
          // Check if it's an auth issue before marking as offline
          fetch(`${getApiBase()}/auth/status`)
            .then((res) => res.json())
            .then((data) => {
              if (data.authenticated === false) {
                setStatus("auth_required");
              } else {
                setStatus("offline");
              }
            })
            .catch(() => setStatus("offline"));
        } else {
          setStatus("connecting");
        }
        reconnectTimerRef.current = setTimeout(() => {
          backoffRef.current = Math.min(backoffRef.current * 2, 30000);
          connectRef.current();
        }, backoffRef.current);
      };

      ws.onerror = () => {
        // onclose will handle reconnection
      };
    } catch {
      failCountRef.current++;
      if (failCountRef.current >= OFFLINE_THRESHOLD) {
        setStatus("offline");
      } else {
        setStatus("connecting");
      }
    }
  }, [flushOutbox]);

  // Paired-device browsers (bearer in localStorage) can't set an Authorization
  // header on a WebSocket and the durable bearer must never ride the socket
  // (F6). Mint a FRESH single-use ticket per (re)connect and present only that.
  // Unpaired browsers (cookie/loopback auth) skip ticketing — unchanged path.
  const connect = useCallback(() => {
    if (getDeviceBearer()) {
      mintWsTicket("browser")
        .then((ticket) => openSocket(ticket ? appendWsTicket(url, ticket) : url))
        .catch(() => openSocket(url));
    } else {
      openSocket(url);
    }
  }, [url, openSocket]);
  connectRef.current = connect;

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      for (const timer of expiryTimersRef.current) clearTimeout(timer);
      expiryTimersRef.current.clear();
      // A `url` change (server switch) means queued entries were addressed to a
      // DIFFERENT server: they must not flush to the new one. Drain and report
      // them as undelivered rather than carrying intent across endpoints.
      const stranded = outboxRef.current;
      if (stranded.length > 0) {
        outboxRef.current = [];
        for (const entry of stranded) notifyUndelivered(entry);
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect, notifyUndelivered]);
  // (plugin-action-bridge registration is set up below in another useEffect
  // after `send` is defined.)

  const send = useCallback((msg: BrowserToServerMessage): SendVerdict => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(msg));
        return { status: "handed" };
      } catch {
        // An OPEN socket can still throw on a closing race; surface it as a
        // rejection rather than letting the exception escape the caller.
        return { status: "rejected", reason: "send_failed" };
      }
    }
    if (!socket) {
      return { status: "rejected", reason: "no_socket" };
    }
    // A socket exists but is CONNECTING/CLOSING/CLOSED: retain the message for
    // flush on reconnect. Prompts expire before the pending-prompt deadline;
    // every other message waits for capacity eviction.
    const isPrompt = (msg as { type?: string }).type === "send_prompt";
    const entry: OutboxEntry = {
      id: nextEntryIdRef.current++,
      msg,
      expiresAt: isPrompt ? Date.now() + OUTBOX_EXPIRY_MS : Number.POSITIVE_INFINITY,
    };
    outboxRef.current.push(entry);
    scheduleEntryExpiry(entry);
    while (outboxRef.current.length > OUTBOX_CAPACITY) {
      const evicted = outboxRef.current.shift();
      // An evicted entry was never transmitted either — say so rather than
      // letting the caller keep believing it may still flush.
      if (evicted) notifyUndelivered(evicted);
    }
    return { status: "queued", entryId: entry.id };
  }, [scheduleEntryExpiry, notifyUndelivered]);

  // Register `send` as the global plugin-action sender so the
  // IntentRenderer's action wiring can route through this connection.
  // See change: adopt-server-driven-intent-rendering.
  useEffect(() => {
    setPluginActionSender(send);
    return () => setPluginActionSender(null);
  }, [send]);

  const onMessage = useCallback((handler: (msg: ServerToBrowserMessage) => void) => {
    handlersRef.current.push(handler);
    return () => {
      handlersRef.current = handlersRef.current.filter((h) => h !== handler);
    };
  }, []);

  return { send, onMessage, status, ws, onOutboxExpiry };
}
