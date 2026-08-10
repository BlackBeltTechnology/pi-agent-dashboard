/**
 * Mock dashboard server for L1 bus-client tests. Mirrors the real handshake:
 *   - `POST /api/ws-ticket` mints a single-use ticket (or denies, for the
 *     off-box scenario).
 *   - WS upgrade at `/ws?ticket=` validates + consumes the ticket, then sends
 *     one `sessions_snapshot` on connect (matching `browser-gateway`).
 *   - test helpers push deltas and capture client→server messages.
 *
 * See OpenSpec change: add-dashboard-bus-client-scripting.
 */
import crypto from "node:crypto";
import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  BrowserToServerMessage,
  ServerToBrowserMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export interface MockServerOptions {
  /** Deny every ticket mint with 403 (off-box / untrusted-network scenario). */
  denyMint?: boolean;
  /** Initial sessions delivered in the on-connect snapshot. */
  sessions?: DashboardSession[];
  /** Ticket TTL (default 15 000, matching the server). */
  ticketTtlMs?: number;
}

export interface MockServer {
  port: number;
  /** Every message the client has sent to the server. */
  received: BrowserToServerMessage[];
  /** Wait until a client message matching `predicate` arrives. */
  waitForMessage<T extends BrowserToServerMessage>(
    predicate: (m: BrowserToServerMessage) => boolean,
  ): Promise<T>;
  /** Broadcast a server→client message to every connected socket. */
  push(msg: ServerToBrowserMessage): void;
  /** Update the snapshot sessions (affects future connects). */
  setSessions(sessions: DashboardSession[]): void;
  close(): Promise<void>;
}

export async function startMockServer(opts: MockServerOptions = {}): Promise<MockServer> {
  const ttl = opts.ticketTtlMs ?? 15_000;
  let sessions = opts.sessions ?? [];
  const tickets = new Map<string, number>(); // value → expiresAt
  const received: BrowserToServerMessage[] = [];
  const sockets = new Set<WebSocket>();
  const messageWaiters = new Set<{
    predicate: (m: BrowserToServerMessage) => boolean;
    resolve: (m: BrowserToServerMessage) => void;
  }>();

  const httpServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/ws-ticket") {
      if (opts.denyMint) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "off-box: pairing required" }));
        return;
      }
      const value = crypto.randomBytes(32).toString("hex");
      tickets.set(value, Date.now() + ttl);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, data: { ticket: value } }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const ticket = url.searchParams.get("ticket");
    const expiresAt = ticket ? tickets.get(ticket) : undefined;
    // Single-use: consume synchronously. Reject expired / missing / reused.
    if (!ticket || expiresAt === undefined || Date.now() > expiresAt) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    tickets.delete(ticket);
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      ws.on("message", (data) => {
        let msg: BrowserToServerMessage;
        try {
          msg = JSON.parse(data.toString()) as BrowserToServerMessage;
        } catch {
          return;
        }
        received.push(msg);
        for (const w of [...messageWaiters]) {
          if (w.predicate(msg)) {
            messageWaiters.delete(w);
            w.resolve(msg);
          }
        }
      });
      ws.on("close", () => sockets.delete(ws));
      // Snapshot on connect (mirrors browser-gateway).
      ws.send(
        JSON.stringify({ type: "sessions_snapshot", sessions, orders: {} }),
      );
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const port = address.port;

  return {
    port,
    received,
    waitForMessage<T extends BrowserToServerMessage>(
      predicate: (m: BrowserToServerMessage) => boolean,
    ): Promise<T> {
      const existing = received.find(predicate);
      if (existing) return Promise.resolve(existing as T);
      return new Promise<T>((resolve) => {
        messageWaiters.add({ predicate, resolve: (m) => resolve(m as T) });
      });
    },
    push(msg: ServerToBrowserMessage): void {
      const raw = JSON.stringify(msg);
      for (const ws of sockets) ws.send(raw);
    },
    setSessions(next: DashboardSession[]): void {
      sessions = next;
    },
    async close(): Promise<void> {
      for (const ws of sockets) ws.close();
      wss.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

/** Minimal session factory for tests. */
export function makeSession(
  id: string,
  status: DashboardSession["status"] = "active",
  extra: Partial<DashboardSession> = {},
): DashboardSession {
  return {
    id,
    cwd: `/repo/${id}`,
    source: "tui",
    status,
    startedAt: 1,
    ...extra,
  } as DashboardSession;
}
