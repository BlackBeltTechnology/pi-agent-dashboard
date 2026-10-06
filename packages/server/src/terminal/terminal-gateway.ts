/**
 * WebSocket upgrade handler for terminal sessions.
 * Handles /ws/terminal/:id binary WebSocket connections.
 */
import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { installSocketLifetime, type LifetimeSocket } from "../identity/socket-lifetime.js";
import type { TerminalManager } from "./terminal-manager.js";

const TERMINAL_PATH_PREFIX = "/ws/terminal/";

export interface TerminalGateway {
  wss: WebSocketServer;
  /** Parse terminal ID from URL, returns null if not a terminal URL. */
  parseTerminalId(url: string): string | null;
  /** Handle WebSocket upgrade for a terminal URL. */
  /**
   * `authorize` (identity plane, 18.13): called with the terminal id once it is
   * known to exist; `false` ⇒ the upgrade is refused before any PTY attach.
   * Absent ⇒ unchanged (inert era).
   */
  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    authorize?: (termId: string) => boolean,
    /**
     * Expiry (ms epoch) of the principal bound to the ticket. The attached PTY
     * socket is closed (4001) at that instant, like a browser socket (§9.4): an
     * owner check at upgrade must not outlive the credential that passed it.
     */
    principalExpiresAt?: number,
  ): void;
  /** Close the WebSocket server. */
  close(): void;
}

export function createTerminalGateway(manager: TerminalManager): TerminalGateway {
  const wss = new WebSocketServer({ noServer: true });

  function parseTerminalId(url: string): string | null {
    if (!url.startsWith(TERMINAL_PATH_PREFIX)) return null;
    const id = url.slice(TERMINAL_PATH_PREFIX.length);
    return id.length > 0 ? id : null;
  }

  function handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    authorize?: (termId: string) => boolean,
    principalExpiresAt?: number,
  ): void {
    // `parseTerminalId` is a startsWith/slice on the raw URL, so a `?ticket=…`
    // query rides the id; strip it before the lookup (unchanged for plain URLs).
    const termId = parseTerminalId(request.url ?? "")?.split("?")[0] ?? null;
    if (!termId || !manager.get(termId)) {
      socket.destroy();
      return;
    }
    // Same refusal as a non-existent terminal: no owned-vs-missing oracle.
    if (authorize && !authorize(termId)) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      manager.attach(termId, ws);
      if (typeof principalExpiresAt === "number") {
        const lifetime = Object.assign(ws, { principalExpiresAt }) as unknown as LifetimeSocket;
        const dispose = installSocketLifetime(lifetime);
        ws.on("close", dispose);
      }
    });
  }

  function close(): void {
    for (const client of wss.clients) {
      client.close();
    }
    wss.close();
  }

  return { wss, parseTerminalId, handleUpgrade, close };
}
