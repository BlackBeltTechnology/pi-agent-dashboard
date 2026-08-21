/**
 * The same protocol over a unix socket (D1).
 *
 * Two properties matter and neither is obvious:
 *   - a bridge can complete `session_register` over UDS (task 1.3);
 *   - WebSocket ping/pong still resolves over UDS, because
 *     `bridge-contention.ts` uses pong frames as its liveness oracle. A
 *     transport without frame-level ping would have re-founded that whole
 *     subsystem (task 1.4).
 *
 * (test-plan #E19 companion — the server half)
 * See change: add-pi-gateway-transport-identity.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createPiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";

let tmp: string;
let sockPath: string;
let gateway: ReturnType<typeof createPiGateway> | null = null;
const sockets: WebSocket[] = [];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-gw-transport-"));
  sockPath = path.join(tmp, "gateway-9999.sock");
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  gateway?.stop();
  gateway = null;
  await new Promise((r) => setTimeout(r, 20));
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Dial the gateway over its unix socket, exactly as the bridge does. */
function dial(): WebSocket {
  const ws = new WebSocket(`ws+unix://${sockPath}:/`);
  sockets.push(ws);
  return ws;
}

const opened = (ws: WebSocket) =>
  new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });

describe("pi-gateway over a unix socket", () => {
  it("accepts a connection and completes session_register", async () => {
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 0 });
    await gateway.startOnSocket(sockPath);

    const ws = dial();
    await opened(ws);
    ws.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "sess-uds-1",
        cwd: tmp,
        pid: process.pid,
      }),
    );

    for (let i = 0; i < 100 && !gateway.isSessionConnected("sess-uds-1"); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(gateway.isSessionConnected("sess-uds-1")).toBe(true);
    expect(gateway.connectionCount()).toBe(1);
  });

  // Task 1.4: the contention probe's liveness oracle must survive the
  // transport swap.
  it("still resolves WebSocket ping/pong over the socket", async () => {
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 0 });
    await gateway.startOnSocket(sockPath);

    const ws = dial();
    await opened(ws);
    const pong = new Promise<void>((resolve, reject) => {
      ws.once("pong", () => resolve());
      setTimeout(() => reject(new Error("no pong over UDS")), 3000);
    });
    ws.ping();
    await expect(pong).resolves.toBeUndefined();
  });

  // Review finding: the heartbeat used to be installed only by start() (the
  // TCP path), so a socket-only listener would have shipped with no ping/pong
  // and a silently no-op contention probe.
  it("runs the ping heartbeat on a socket-only listener", async () => {
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 20 });
    await gateway.startOnSocket(sockPath);

    const ws = dial();
    await opened(ws);
    // The SERVER pings us; a client that never sees one has no liveness oracle.
    await expect(
      new Promise<void>((resolve, reject) => {
        ws.once("ping", () => resolve());
        setTimeout(() => reject(new Error("server never pinged over UDS")), 3000);
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses start() after startOnSocket() rather than orphaning the listener", async () => {
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 0 });
    await gateway.startOnSocket(sockPath);
    expect(() => gateway?.start(0)).toThrow(/orphan the socket listener/);
  });

  // Task 2.9: a UDS listener's address() is a string, and reporting null
  // blanked the gateway endpoint in the settings UI.
  it("reports the socket path from address() and transport()", async () => {
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 0 });
    await gateway.startOnSocket(sockPath);
    expect(gateway.address()).toBe(sockPath);
    expect(gateway.transport()).toEqual({ transport: "unix", path: sockPath });
  });

  it("removes the socket file on stop, and stop is idempotent", async () => {
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 0 });
    await gateway.startOnSocket(sockPath);
    expect(fs.existsSync(sockPath)).toBe(true);

    gateway.stop();
    // stop() is synchronous by contract and hands the teardown off, so poll.
    for (let i = 0; i < 100; i++) {
      if (!fs.existsSync(sockPath) && !fs.existsSync(`${sockPath}.lock`)) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(fs.existsSync(sockPath)).toBe(false);
    // The companion bind-lock sentinel goes too, or it accumulates forever.
    expect(fs.existsSync(`${sockPath}.lock`)).toBe(false);
    expect(() => gateway?.stop()).not.toThrow();
  });
});
