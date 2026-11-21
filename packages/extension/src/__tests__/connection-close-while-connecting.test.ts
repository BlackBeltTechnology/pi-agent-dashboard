/**
 * Regression: tearing down a socket that is still CONNECTING must not crash pi.
 *
 * `ws` (the real library) emits an async 'error' event when `close()` is called
 * on a CONNECTING socket ("WebSocket was closed before the connection was
 * established"). `handleDisconnect` used to detach `onerror` before closing, so
 * that event had no listener and Node killed the whole pi process with exit 1.
 * Observed in the field: watchdog force-close fired on a reconnect dial that
 * was stuck in CONNECTING under host load.
 */
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket as WsWebSocket } from "ws";
import { ConnectionManager } from "../connection.js";

describe("ConnectionManager — teardown while CONNECTING", () => {
  let server: net.Server | null = null;
  const sockets: net.Socket[] = [];

  afterEach(async () => {
    for (const s of sockets) s.destroy();
    sockets.length = 0;
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = null;
  });

  it("handleDisconnect on a CONNECTING real `ws` socket leaves an error listener attached", async () => {
    // Accepts TCP but never answers the HTTP upgrade → socket stays CONNECTING.
    server = net.createServer((s) => { sockets.push(s); });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    const { port } = server.address() as net.AddressInfo;

    const created: WsWebSocket[] = [];
    class RecordingWs extends WsWebSocket {
      constructor(...args: ConstructorParameters<typeof WsWebSocket>) {
        super(...args);
        created.push(this);
      }
    }

    const cm = new ConnectionManager({ url: `ws://127.0.0.1:${port}`, WebSocketImpl: RecordingWs as any });
    cm.connect();
    await new Promise((r) => setTimeout(r, 50));
    const ws = created[0];
    expect(ws.readyState).toBe(WsWebSocket.CONNECTING);

    const escaped: unknown[] = [];
    const origEmit = ws.emit.bind(ws);
    ws.emit = ((event: string, ...rest: unknown[]) => {
      if (event === "error" && ws.listenerCount("error") === 0) escaped.push(rest[0]);
      return event === "error" && ws.listenerCount("error") === 0 ? false : origEmit(event, ...rest);
    }) as typeof ws.emit;

    (cm as any).handleDisconnect();
    await new Promise((r) => setTimeout(r, 50));

    expect(escaped).toEqual([]);
    cm.disconnect();
  });
});
