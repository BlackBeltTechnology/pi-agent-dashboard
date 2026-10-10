/**
 * Health probes against real local fixture servers; the ws probe sends
 * nothing and carries no credentials. See change: add-service-registry-core
 * (test-plan E39) + the exposure field.
 */
import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { createLimiter, probeHttp, probeTcp, probeWsFirstMessage } from "../health.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

async function listen(server: http.Server | net.Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  closers.push(() => new Promise((r) => server.close(() => r())));
  return (server.address() as net.AddressInfo).port;
}

async function closedPort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const p = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}

describe("E39 — probe kinds", () => {
  it("http: 200 passes, 500 fails, closed fails", async () => {
    const ok = await listen(http.createServer((_q, s) => s.writeHead(200).end("ok")));
    const bad = await listen(http.createServer((_q, s) => s.writeHead(500).end()));
    expect(await probeHttp(`http://127.0.0.1:${ok}/health`)).toBe(true);
    expect(await probeHttp(`http://127.0.0.1:${bad}/health`)).toBe(false);
    expect(await probeHttp(`http://127.0.0.1:${await closedPort()}/`, 500)).toBe(false);
  });

  it("tcp: open passes, closed fails", async () => {
    const open = await listen(net.createServer((c) => c.end()));
    expect(await probeTcp(`tcp://127.0.0.1:${open}`)).toBe(true);
    expect(await probeTcp(`tcp://127.0.0.1:${await closedPort()}`, 500)).toBe(false);
  });

  it("ws-first-message: hello passes, silence fails; the probe sends 0 bytes and no auth", async () => {
    const seen: { headers: http.IncomingHttpHeaders[]; frames: number } = { headers: [], frames: 0 };
    const mk = async (hello: boolean) => {
      const server = http.createServer();
      const wss = new WebSocketServer({ server });
      wss.on("connection", (sock, req) => {
        seen.headers.push(req.headers);
        sock.on("message", () => seen.frames++);
        if (hello) sock.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: "5.0.0", rpcVersion: 1 } }));
      });
      closers.push(async () => {
        for (const c of wss.clients) c.terminate();
        wss.close();
      });
      return listen(server);
    };
    const hello = await mk(true);
    const silent = await mk(false);
    expect(await probeWsFirstMessage(`ws://127.0.0.1:${hello}`)).toBe(true);
    expect(await probeWsFirstMessage(`ws://127.0.0.1:${silent}`, 300)).toBe(false);
    expect(seen.frames).toBe(0);
    for (const h of seen.headers) {
      expect(h.authorization).toBeUndefined();
      expect(h.cookie).toBeUndefined();
    }
  });
});

describe("limiter", () => {
  it("never exceeds its cap", async () => {
    const limit = createLimiter(4);
    let active = 0;
    let max = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        limit(async () => {
          active++;
          max = Math.max(max, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    expect(max).toBe(4);
  });
});
