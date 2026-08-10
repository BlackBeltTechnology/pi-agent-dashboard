import { setSender as setPluginActionSender } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { BrowserToServerMessage, ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase } from "../lib/api/api-context.js";
import { appendWsTicket, getDeviceBearer, mintWsTicket } from "../lib/pairing/device-auth.js";

export type ConnectionStatus = "connected" | "connecting" | "offline" | "auth_required";

const OFFLINE_THRESHOLD = 3;

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const handlersRef = useRef<((msg: ServerToBrowserMessage) => void)[]>([]);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);
  const failCountRef = useRef(0);
  // Holds the latest `connect` so the onclose reconnect timer always re-runs
  // the current ticket-minting path (avoids capturing a stale closure).
  const connectRef = useRef<() => void>(() => {});

  const openSocket = useCallback((finalUrl: string) => {
    try {
      const ws = new WebSocket(finalUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        backoffRef.current = 1000;
        failCountRef.current = 0;
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
  }, []);

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
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);
  // (plugin-action-bridge registration is set up below in another useEffect
  // after `send` is defined.)

  const send = useCallback((msg: BrowserToServerMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

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

  return { send, onMessage, status };
}
