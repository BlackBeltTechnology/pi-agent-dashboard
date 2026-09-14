/**
 * SHIM — NOT upstream code. Replaces upstream `packages/utils/wsServer.ts`
 * (which builds its own http.Server + WebSocketServer). See ../NOTICE.
 *
 * The plugin never binds its own HTTP listener: `relay-instance.ts` receives
 * already-upgraded sockets through `ctx.registerWsRoute` (design
 * add-browser-relay D2 — adapt via the wrapper, never by editing vendor
 * files). Upstream `CDPRelayServer` constructs a `WSServer` eagerly in its
 * constructor but only `listen()` opens a port, so the constructor stays
 * inert (stores options) and every transport operation throws a loud, named
 * error rather than silently no-op'ing.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocket } from "ws";

export interface WSServerOptions {
  onRequest: (request: IncomingMessage, response: ServerResponse) => void;
  onHeaders: (headers: Record<string, string>) => void;
  onUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;
  isAllowedPathname: (pathname: string) => boolean;
  onConnection: (request: IncomingMessage, url: URL, ws: WebSocket) => void;
}

export function notSupportedTransport(): Error {
  return new Error(
    "not supported — transport is supplied by relay-instance.ts via ctx.registerWsRoute; the vendored WSServer is a shim",
  );
}

export class WSServer {
  constructor(private readonly _options: WSServerOptions) {
    // Inert by design: upstream's constructor also only stores options; the
    // HTTP server is created in listen(), which this shim never runs.
  }

  /** Transport entry point — always throws (see file header). */
  listen(_port: number, _host?: string, _pathPrefix?: string): Promise<string> {
    throw notSupportedTransport();
  }

  /**
   * Upstream calls `close().catch(logUnhandledError)`, so a REJECTED promise
   * is surfaced by the vendored error logger instead of crashing the caller.
   */
  close(): Promise<void> {
    return Promise.reject(notSupportedTransport());
  }
}
