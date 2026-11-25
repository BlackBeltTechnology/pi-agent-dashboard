/**
 * Tier-5 in-flight WS closes with the pid (change: serve-live-previews-on-capability-origin, test-plan #E78 #X20c).
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPreviewWsRegistry } from "../live-server/preview-ws-registry.js";

const open: net.Socket[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.destroy();
});

/** A connected loopback pair: `server` is the end the registry tracks, `client` observes the close. */
async function pair(): Promise<{ server: net.Socket; client: net.Socket }> {
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as net.AddressInfo).port;
  const [server, client] = await Promise.all([
    new Promise<net.Socket>((r) => srv.once("connection", r)),
    new Promise<net.Socket>((r) => {
      const c = net.connect(port, "127.0.0.1", () => r(c));
    }),
  ]);
  srv.close();
  open.push(server, client);
  return { server, client };
}
const closed = (s: net.Socket) => new Promise<void>((r) => (s.destroyed ? r() : s.once("close", () => r())));

describe("T.E78 / T.X20(c) — preview WS registry", () => {
  it("closes every socket under a dropped pid and leaves other pids alone", async () => {
    const reg = createPreviewWsRegistry();
    const a1 = await pair();
    const a2 = await pair();
    const b = await pair();
    reg.track("pidA", a1.server);
    reg.track("pidA", a2.server);
    reg.track("pidB", b.server);

    expect(reg.closePid("pidA")).toBe(2);
    await Promise.all([closed(a1.client), closed(a2.client)]);
    expect(b.server.destroyed).toBe(false);
    expect(reg.closePid("pidA")).toBe(0); // already gone
    expect(reg.closePid("never-tracked")).toBe(0);
  });

  it("a socket that closed on its own is untracked (no leak, no double destroy)", async () => {
    const reg = createPreviewWsRegistry();
    const p = await pair();
    reg.track("pid", p.server);
    p.client.destroy();
    await closed(p.server);
    expect(reg.closePid("pid")).toBe(0);
  });

  it("an in-flight HTTP response (a stream) is destroyed with its pid and untracked once it ends (P11)", async () => {
    const reg = createPreviewWsRegistry();
    const srv = http.createServer((req, res) => {
      res.writeHead(200);
      res.write("start\n");
      if (req.url === "/done") return res.end();
      reg.track("pid", res);
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    try {
      const port = (srv.address() as net.AddressInfo).port;
      const get = (path: string) =>
        new Promise<http.IncomingMessage>((r) => http.get({ host: "127.0.0.1", port, path, agent: false }, r));
      const stream = await get("/stream");
      const ended = new Promise<void>((r) => stream.once("close", () => r()));
      stream.resume();
      expect(reg.closePid("pid")).toBe(1);
      await ended;
      // A response that finished on its own leaves nothing behind.
      const done = await get("/done");
      done.resume();
      await new Promise<void>((r) => done.once("close", () => r()));
      expect(reg.closePid("pid")).toBe(0);
    } finally {
      srv.closeAllConnections();
      srv.close();
    }
  });

  /** @structural-pin server.ts is a ~6k-line composition root: the wiring is checked in its text */
  it("server.ts closes sockets on onDrop and tracks every admitted tier-5 upgrade", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../server.ts"), "utf-8");
    expect(src).toMatch(/onDrop: \(reason, pid\) => \{.{0,200}previewWs\.closePid\(pid\)/s);
    expect(src).toMatch(/if \(previewWsGrant && previewWsPath\) previewWs\.track\(previewWsPath\.pid, socket\)/);
    expect(src).toMatch(/trackPreviewResponse: \(pid, res\) => previewWs\.track\(pid, res\)/);
  });
});
