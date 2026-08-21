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
    for (let i = 0; i < 100 && fs.existsSync(sockPath); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(fs.existsSync(sockPath)).toBe(false);
    expect(() => gateway?.stop()).not.toThrow();
  });
});
