/**
 * Minimal local-only WebSocket client to the dashboard gateway (host B).
 *
 * Deliberately NOT the extension's `ConnectionManager` (which is entangled with
 * pi session lifecycle): one endpoint (env pin → HOME rendezvous record), the
 * local credential plan for a loopback TCP dial (Windows), backoff reconnect.
 *
 * Buffering contract with the adapter: before the FIRST open, frames are
 * buffered and flushed in order. After a drop nothing is buffered — the adapter
 * regenerates its state on `reconnected()` (register → lists → event-log replay),
 * and events produced meanwhile live in its durable log. Heartbeats come from
 * the adapter core (it owns session state), not from here.
 *
 * See change: add-acp-session-driver (D1, "Registration, heartbeat and initialization").
 */
import { localCredentialPlan } from "@blackbelt-technology/pi-dashboard-extension/src/local-token-header.js";
import type { ExtensionToServerMessage, ServerToExtensionMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { rendezvousEndpoint } from "@blackbelt-technology/pi-dashboard-shared/rendezvous.js";
import WebSocket from "ws";

const BUFFER_CAP = 1000;
const BACKOFF_MS = [500, 1000, 2000, 5000, 10_000];

export interface GatewayClientOptions {
  /** Explicit endpoint (tests). Default: env pin → rendezvous record. */
  endpoint?: () => string | undefined;
  onOpen: (first: boolean) => void;
  onMessage: (m: ServerToExtensionMessage) => void;
  onClose: () => void;
  log: (line: string) => void;
}

export interface GatewayClient {
  connect(): void;
  send(m: ExtensionToServerMessage): void;
  close(): void;
  isOpen(): boolean;
}

/** `PI_DASHBOARD_SOCKET` / `PI_DASHBOARD_URL` pin; else the HOME-derived rendezvous endpoint. */
function resolveGatewayEndpoint(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const socket = env.PI_DASHBOARD_SOCKET?.trim();
  if (socket) return `ws+unix://${socket}:/`;
  const url = env.PI_DASHBOARD_URL?.trim();
  if (url) return url;
  return rendezvousEndpoint()?.endpoint;
}

export function createGatewayClient(o: GatewayClientOptions): GatewayClient {
  let ws: WebSocket | undefined;
  let everOpened = false;
  let closing = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const buffer: string[] = [];

  async function dial(): Promise<void> {
    const endpoint = (o.endpoint ?? resolveGatewayEndpoint)();
    if (!endpoint) return scheduleRetry("no dashboard endpoint resolvable");
    try {
      const plan = await localCredentialPlan(endpoint);
      const socket = new WebSocket(endpoint, {
        ...(plan?.headers ? { headers: plan.headers } : {}),
        ...(plan?.createConnection ? { createConnection: plan.createConnection as never } : {}),
      });
      ws = socket;
      socket.on("open", () => {
        attempt = 0;
        const first = !everOpened;
        everOpened = true;
        if (first) for (const raw of buffer.splice(0)) socket.send(raw);
        o.onOpen(first);
      });
      socket.on("message", (data) => {
        try {
          o.onMessage(JSON.parse(data.toString("utf8")) as ServerToExtensionMessage);
        } catch {
          /* malformed frame from the server: ignore */
        }
      });
      socket.on("close", () => {
        plan?.dispose?.();
        if (ws === socket) ws = undefined;
        if (everOpened) o.onClose();
        if (!closing) scheduleRetry("connection closed");
      });
      socket.on("error", (err) => o.log(`[acp-bridge] gateway socket error: ${err.message}`));
    } catch (err) {
      scheduleRetry(err instanceof Error ? err.message : String(err));
    }
  }

  function scheduleRetry(why: string): void {
    if (closing || retryTimer) return;
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] as number;
    attempt += 1;
    o.log(`[acp-bridge] gateway unavailable (${why}); retry in ${delay} ms`);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      dial().catch(() => {});
    }, delay);
  }

  return {
    connect: () => void dial(),
    send(m) {
      const raw = JSON.stringify(m);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(raw);
      else if (!everOpened && buffer.length < BUFFER_CAP) buffer.push(raw);
    },
    close() {
      closing = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    },
    isOpen: () => ws?.readyState === WebSocket.OPEN,
  };
}
