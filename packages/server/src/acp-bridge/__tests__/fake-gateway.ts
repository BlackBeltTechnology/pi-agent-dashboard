/**
 * Test double for the pi gateway: a real WebSocket server that records every
 * bridge frame and can push server→bridge messages / drop connections.
 * See change: add-acp-session-driver.
 */
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";

export interface FakeGateway {
  url: string;
  frames: Array<Record<string, any>>;
  /** Frames grouped per connection (index = connection number). */
  connections: Array<Array<Record<string, any>>>;
  send(m: Record<string, unknown>): void;
  dropClients(): void;
  waitFor(pred: () => boolean, ms?: number): Promise<void>;
  close(): Promise<void>;
}

export async function startFakeGateway(port = 0): Promise<FakeGateway> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  const frames: Array<Record<string, any>> = [];
  const connections: Array<Array<Record<string, any>>> = [];
  const sockets = new Set<WebSocket>();
  wss.on("connection", (ws) => {
    sockets.add(ws);
    const mine: Array<Record<string, any>> = [];
    connections.push(mine);
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString("utf8"));
      frames.push(m);
      mine.push(m);
    });
    ws.on("close", () => sockets.delete(ws));
  });
  const addr = wss.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${addr.port}`,
    frames,
    connections,
    send(m) {
      for (const s of sockets) s.send(JSON.stringify(m));
    },
    dropClients() {
      for (const s of sockets) s.terminate();
    },
    async waitFor(pred, ms = 3000) {
      const t0 = Date.now();
      while (!pred()) {
        if (Date.now() - t0 > ms) throw new Error(`gateway waitFor timeout; frames: ${frames.map((f) => f.type).join(",")}`);
        await new Promise((r) => setTimeout(r, 10));
      }
    },
    close: () =>
      new Promise<void>((res) => {
        for (const s of sockets) s.terminate();
        wss.close(() => res());
      }),
  };
}
