/**
 * Real-socket fixture for the browser gateway: an HTTP server whose upgrade
 * handler hands sockets to `gateway.wss.handleUpgrade` (as `server.ts` does),
 * plus a `ws` client factory. Lets close codes, reasons and protocol
 * ping/pong travel over a real TCP connection.
 *
 * See change: harden-ios-safari-memory-and-ws-diagnostics.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { type ClientOptions, WebSocket } from "ws";
import type { BrowserGateway } from "../../pairing/browser-gateway.js";
import { createBrowserGateway } from "../../pairing/browser-gateway.js";
import { createMemoryEventStore } from "../../persistence/memory-event-store.js";
import { createMemorySessionManager } from "../../session/memory-session-manager.js";
import { makeStubPiGateway } from "./load-fixtures.js";

export interface RealBrowserWsHarness {
  gateway: BrowserGateway;
  /** Open a client socket; resolves once it is open. */
  connect(opts?: ClientOptions): Promise<WebSocket>;
  /** Terminate all server-side clients, close the wss and the HTTP server. */
  close(): Promise<void>;
}

export async function startRealBrowserWs(browserPingIntervalMs?: number): Promise<RealBrowserWsHarness> {
  const gateway = createBrowserGateway(
    createMemorySessionManager(),
    createMemoryEventStore(() => false),
    makeStubPiGateway(),
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined,
    browserPingIntervalMs,
  );
  const server = http.createServer();
  server.on("upgrade", (req, socket, head) => {
    gateway.wss.handleUpgrade(req, socket, head, (ws) => gateway.wss.emit("connection", ws, req));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;

  return {
    gateway,
    connect: (opts) =>
      new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, opts);
        ws.once("open", () => resolve(ws));
        ws.once("error", reject);
      }),
    close: async () => {
      for (const c of gateway.wss.clients) c.terminate();
      await new Promise<void>((r) => gateway.wss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** Resolve once `pred()` holds, polling on real timers. */
export async function until(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("until: timed out");
    await new Promise((r) => setImmediate(r));
  }
}
