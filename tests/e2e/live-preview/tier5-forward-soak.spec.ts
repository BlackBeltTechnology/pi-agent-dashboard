import { execFileSync } from "node:child_process";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { expect, test } from "./fixture.js";
import { readState } from "./isolated-server.js";
import { bearerApi, mintTier5Path, pairDevice, registerTarget, revokeDevice, sleep } from "./tier5-helpers.js";

/**
 * L2 — D8 forwarding soak with WebSocket (host-run isolated server, no browser): 20 concurrent WebSockets + 20 HTTP
 * streams under `/preview/<pid>/`, then the pid is dropped by a holder revoke. Every upstream socket must be destroyed
 * once the drop settles (0 leaked sockets). Per Q48 no time-to-close number is asserted — only that it converges, and
 * that the server's memory does not grow without bound while 40 streams are live (RSS is recorded, not thresholded).
 * Row: test-plan #P11. See change: serve-live-previews-on-capability-origin (task 8.3).
 */
const N = 20;
/** The server's idle sweep is 60 s; the drop settles within a few sweeps. Q48: not a time-to-close assertion, a liveness bound. */
const SETTLE_MS = 180_000;

interface Soak {
  port: number;
  /** Currently open TCP connections to the upstream. */
  open(): number;
  /** Open `/stream/*` response bodies and accepted WebSocket upgrades. */
  streams(): number;
  sockets(): number;
  close(): Promise<void>;
}

/** An upstream with N-endless chunked bodies on `/stream/*` and a WebSocket echo anywhere else; counts its own sockets. */
async function startSoakUpstream(): Promise<Soak> {
  const conns = new Set<Socket>();
  const streaming = new Set<http.ServerResponse>();
  const wsConns = new Set<WebSocket>();
  const server = http.createServer((req, res) => {
    if (req.url?.includes("/stream/")) {
      res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" });
      streaming.add(res);
      const t = setInterval(() => res.write("tick\n"), 100);
      res.on("close", () => {
        clearInterval(t);
        streaming.delete(res);
      });
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  server.on("connection", (s) => {
    conns.add(s);
    s.on("close", () => conns.delete(s));
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wsConns.add(ws);
      ws.on("close", () => wsConns.delete(ws));
      ws.on("message", (m) => ws.send(String(m)));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    open: () => conns.size,
    streams: () => streaming.size,
    sockets: () => wsConns.size,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of conns) s.destroy();
        wss.close();
        server.close(() => resolve());
      }),
  };
}

const rssKb = (pid: number): number => Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim());

test("T.P11 / #P11 20 WebSockets + 20 HTTP streams under /preview/<pid>/ all die with the pid when a holder is revoked", async ({ isolatedServer }) => {
  test.setTimeout(SETTLE_MS + 120_000);
  const soak = await startSoakUpstream();
  const clients: WebSocket[] = [];
  const streamReqs: http.ClientRequest[] = [];
  const device = await pairDevice(isolatedServer, "p11-holder");
  try {
    const targetId = await registerTarget(isolatedServer, soak.port, "p11");
    // Holder 1 = the local operator; holder 2 = a paired device that joins the SAME pid.
    const pidPath = await mintTier5Path(isolatedServer, targetId);
    const joined = await bearerApi(isolatedServer, device.token, "POST", `/api/live-server/${targetId}/capability`, { accept: ["preview"] });
    expect(joined.json.path, "the second holder joins the same pid").toBe(pidPath);
    const mark = isolatedServer.logMark();
    const serverPid = readState().pid;
    const rssBefore = rssKb(serverPid);

    // 20 WebSockets + 20 chunked streams — what a browser frame sends carries NO dashboard cookie.
    let streamBytes = 0;
    let streamEnded = 0;
    await Promise.all(
      Array.from({ length: N }, (_, i) => {
        const ws = new WebSocket(`ws://127.0.0.1:${isolatedServer.port}${pidPath}ws/${i}`);
        clients.push(ws);
        return new Promise<void>((resolve, reject) => {
          ws.once("open", () => resolve());
          ws.once("error", reject);
        });
      }),
    );
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        new Promise<void>((resolve, reject) => {
          const req = http.get({ host: "127.0.0.1", port: isolatedServer.port, path: `${pidPath}stream/${i}`, agent: false }, (res) => {
            expect(res.statusCode).toBe(200);
            res.on("data", (c: Buffer) => {
              streamBytes += c.length;
            });
            res.on("close", () => {
              streamEnded++;
            });
            res.once("data", () => resolve());
          });
          streamReqs.push(req);
          req.once("error", (e) => {
            if (streamEnded === 0) reject(e);
          });
        }),
      ),
    );
    await expect.poll(() => soak.streams() + soak.sockets(), { message: "the upstream sees all 40 forwarded streams" }).toBe(2 * N);
    expect(soak.open(), "one upstream TCP connection per stream / socket").toBeGreaterThanOrEqual(2 * N);

    // Soak: the streams keep flowing for a while without the server's memory running away (trend recorded, not thresholded: Q48).
    await sleep(3_000);
    const bytesAfterSoak = streamBytes;
    expect(bytesAfterSoak, "the HTTP streams are really flowing").toBeGreaterThan(0);
    const rssSoak = rssKb(serverPid);

    // Drop the pid: revoking ANY holder drops the shared pid for everyone (D-U7). Liveness is re-checked at use / sweep.
    await revokeDevice(isolatedServer, device.id);

    await expect
      .poll(() => isolatedServer.livePreviewLog(mark).join("\n"), { timeout: SETTLE_MS, intervals: [1_000], message: "the server drops the pid for holder-revoked" })
      .toMatch(/pid dropped reason=holder-revoked/);
    await expect
      .poll(() => ({ open: soak.open(), streams: soak.streams(), sockets: soak.sockets() }), {
        timeout: SETTLE_MS,
        intervals: [500],
        message: "every upstream socket is destroyed once the drop settles",
      })
      .toEqual({ open: 0, streams: 0, sockets: 0 });
    // The browser-facing sides are gone too (nothing is left half-open on the dashboard).
    await expect.poll(() => clients.every((c) => c.readyState === WebSocket.CLOSED), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => streamEnded, { timeout: 30_000 }).toBe(N);

    // The dropped pid is dead for new traffic too (404 under proof; the dashboard never serves it).
    const after = await isolatedServer.api("GET", `${pidPath}after`);
    expect(after.status).toBe(404);
    const rssAfter = rssKb(serverPid);
    test.info().annotations.push({ type: "rss-kb", description: `before=${rssBefore} soak=${rssSoak} after=${rssAfter} (trend only, Q48)` });
    // No unbounded buffer growth: the 40 live streams must not have ballooned the server (generous same-run bound; the trend is annotated).
    expect(rssSoak - rssBefore, "RSS growth while 40 streams are live stays far below a leak").toBeLessThan(512 * 1024);
  } finally {
    for (const c of clients) c.terminate();
    for (const r of streamReqs) r.destroy();
    await soak.close();
    await revokeDevice(isolatedServer, device.id).catch(() => undefined);
  }
});
