/**
 * Integration: server-side Supervised-mode state over the real bridge socket —
 * registration reconcile (E31), re-send after register and reconnect (X23), the
 * bridge's `supervised_state` report, and malformed reports.
 * See change: add-supervised-tool-approval — test-plan #E31, #X23.
 */
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer, type ServerConfig } from "../server.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const baseConfig: ServerConfig = {
  port: 0, piPort: 0, host: "127.0.0.1", dev: true, autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
};

describe("supervised mode state (integration)", () => {
  let server: DashboardServer;
  let piPort: number;
  let browserPort: number;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const s of sockets) s.close();
    sockets.length = 0;
    await server.stop();
  });

  async function boot() {
    server = await createServer({ ...baseConfig });
    await server.start();
    browserPort = server.httpPort()!;
    piPort = server.piPort()!;
  }
  async function openBridge(): Promise<{ ws: WebSocket; got: any[] }> {
    const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
    const got: any[] = [];
    ws.on("message", (raw) => { try { got.push(JSON.parse(String(raw))); } catch { /* ignore */ } });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    sockets.push(ws);
    return { ws, got };
  }
  const send = (ws: WebSocket, msg: Record<string, unknown>) => ws.send(JSON.stringify(msg));
  const register = (ws: WebSocket, extra: Record<string, unknown> = {}) => {
    send(ws, { type: "session_register", sessionId: "s1", cwd: "/tmp", source: "cli", ...extra });
    send(ws, { type: "replay_complete", sessionId: "s1" });
  };
  const setSupervised = (got: any[]) => got.filter((m) => m.type === "set_supervised");
  async function session(): Promise<Record<string, any> | undefined> {
    const res = await fetch(`http://127.0.0.1:${browserPort}/api/sessions`);
    return ((await res.json()) as { data: any[] }).data.find((s) => s.id === "s1");
  }

  it("E31 first registration: the bridge's {on,rev} stands, is stored, broadcast on the session, and echoed back as set_supervised", async () => {
    await boot();
    const { ws, got } = await openBridge();
    register(ws, { supervised: { on: true, rev: 2 }, toolGateOwner: "chat-gateway" });
    await wait(150);
    expect(setSupervised(got)).toEqual([{ type: "set_supervised", on: true, rev: 2 }]);
    expect(await session()).toMatchObject({ supervised: true, supervisedRev: 2, toolGateOwner: "chat-gateway" });
  });

  it("E31/X23 reconnect: a higher stored rev wins over the bridge's, and set_supervised is re-sent on every register", async () => {
    await boot();
    const first = await openBridge();
    register(first.ws, { supervised: { on: true, rev: 2 } });
    await wait(150);
    // the bridge reports a later flip (OFF, rev 5) → server adopts it, no echo needed
    send(first.ws, { type: "supervised_state", sessionId: "s1", on: false, rev: 5 });
    await wait(100);
    expect(await session()).toMatchObject({ supervised: false, supervisedRev: 5 });
    expect(setSupervised(first.got)).toHaveLength(1); // only the register echo

    first.ws.close();
    await wait(300);
    // reconnect with a STALE bridge copy ({true,4}): the server's {false,5} wins and is pushed down
    const again = await openBridge();
    register(again.ws, { supervised: { on: true, rev: 4 } });
    await wait(150);
    expect(setSupervised(again.got)).toEqual([{ type: "set_supervised", on: false, rev: 5 }]);
    expect(await session()).toMatchObject({ supervised: false, supervisedRev: 5 });
  });

  it("E31 a tie with different values, or a bridge with no rev, resolves to Supervised", async () => {
    await boot();
    const a = await openBridge();
    register(a.ws, { supervised: { on: false, rev: 5 } });
    await wait(150);
    a.ws.close();
    await wait(300);
    const b = await openBridge();
    register(b.ws, { supervised: { on: true, rev: 5 } });
    await wait(150);
    expect(setSupervised(b.got)).toEqual([{ type: "set_supervised", on: true, rev: 5 }]);
    b.ws.close();
    await wait(300);
    // bridge lost its session entry (rev 0): ordering unknown → Supervised
    const c = await openBridge();
    register(c.ws, { supervised: { on: false, rev: 0 } });
    await wait(150);
    expect(setSupervised(c.got)).toEqual([{ type: "set_supervised", on: true, rev: 5 }]);
  });

  it("supervised_state: a mismatching report is answered with the stored winner; a matching one is not; owner change is stored", async () => {
    await boot();
    const { ws, got } = await openBridge();
    register(ws, { supervised: { on: true, rev: 3 } });
    await wait(150);
    got.length = 0;
    // stale report (rev 1 < stored 3): server keeps {true,3} and corrects the bridge
    send(ws, { type: "supervised_state", sessionId: "s1", on: false, rev: 1 });
    await wait(100);
    expect(setSupervised(got)).toEqual([{ type: "set_supervised", on: true, rev: 3 }]);
    expect(await session()).toMatchObject({ supervised: true, supervisedRev: 3 });
    got.length = 0;
    // matching report with a new tool-gate owner: stored, no echo
    send(ws, { type: "supervised_state", sessionId: "s1", on: true, rev: 3, toolGateOwner: "chat-gateway" });
    await wait(100);
    expect(setSupervised(got)).toEqual([]);
    expect(await session()).toMatchObject({ supervised: true, supervisedRev: 3, toolGateOwner: "chat-gateway" });
  });

  it("an older bridge that reports nothing is left alone; a malformed supervised_state is ignored", async () => {
    await boot();
    const { ws, got } = await openBridge();
    register(ws);
    await wait(150);
    expect(setSupervised(got)).toEqual([]);
    expect((await session())?.supervised).toBeUndefined();
    send(ws, { type: "supervised_state", sessionId: "s1", on: "yes", rev: 1 });
    await wait(100);
    expect((await session())?.supervised).toBeUndefined();
  });
});
