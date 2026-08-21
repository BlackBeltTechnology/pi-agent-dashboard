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

// ──────────────────────────────────────────────────────────────────────────
// (test-plan #E18) Local authorisation IS socket ownership — section 4, D5.
//
// The point of the UDS transport is that there is no token to mint, leak,
// rotate or replay: the kernel enforces `0600` in a `0700` directory. Two
// properties follow, and both must be asserted or the design silently drifts
// back to a token.
// ──────────────────────────────────────────────────────────────────────────
describe("local authorisation on the socket (D5)", () => {
  // (task 4.3) No token is required — and none is accepted as a substitute
  // for owning the socket. A bridge that presents nothing must work.
  it("requires no token: a tokenless bridge registers", async () => {
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 0 });
    await gateway.startOnSocket(sockPath);

    const ws = dial(); // no headers, no query string, no credential of any kind
    await opened(ws);
    ws.send(
      JSON.stringify({ type: "session_register", sessionId: "sess-no-token", cwd: tmp }),
    );
    for (let i = 0; i < 100 && !gateway.isSessionConnected("sess-no-token"); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(gateway.isSessionConnected("sess-no-token")).toBe(true);
  });

  // (task 4.2) A connection from another uid is refused — by the kernel,
  // through the file mode, before any of our code runs.
  //
  // SKIPPED, with the reason recorded rather than a vacuous pass: asserting it
  // needs a second OS user, and the CI user cannot drop privileges. What CAN
  // be verified here is the mechanism the refusal rests on: the socket is
  // `0600` and its directory `0700`, so no other uid can even open it. That is
  // asserted in `gateway-socket-bind.test.ts`; the two-user test belongs to
  // the QA arm (task 5.7).
  it.skip("refuses a connection from another uid (needs a second OS user — QA arm)", () => {});

  it.skipIf(process.platform === "win32")(
    "leaves the LIVE socket 0600 in a 0700 dir, not just at bind time",
    async () => {
      const sessionManager = createMemorySessionManager();
      gateway = createPiGateway(sessionManager, { pingInterval: 0 });
      await gateway.startOnSocket(sockPath);
      const ws = dial();
      await opened(ws);
      expect(fs.statSync(sockPath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(sockPath)).mode & 0o777).toBe(0o700);
    },
  );
});

/**
 * #P4 (task 12.21) — transport parity.
 *
 * Switching the default local transport to UDS is only defensible if the
 * protocol is not slower over it. Measured as round-trip latency through the
 * live gateway (echoed `session_heartbeat` acknowledgement is not guaranteed,
 * so this uses ping/pong — the same frames `bridge-contention.ts` depends on,
 * which therefore also proves both transports carry them).
 *
 * The assertion is a RATIO with generous headroom, not an absolute budget: an
 * absolute number would encode this machine's speed into the suite.
 */
describe("socket transport parity (#P4)", () => {
  // Kept modest on purpose: the corpus has latency-budget tests that go red
  // under CPU load, so a parity check must not itself be the load.
  const ROUNDS = 80;

  async function measure(ws: WebSocket): Promise<number[]> {
    const samples: number[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      const t0 = performance.now();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("pong timeout")), 2000);
        ws.once("pong", () => {
          clearTimeout(timer);
          resolve();
        });
        ws.ping();
      });
      samples.push(performance.now() - t0);
    }
    return samples.sort((a, b) => a - b);
  }

  const p95 = (sorted: number[]) => sorted[Math.floor(sorted.length * 0.95)];

  it("UDS p95 is not worse than TCP p95 by more than 20%", async () => {
    // TCP arm.
    const tcpGateway = createPiGateway(createMemorySessionManager(), { pingInterval: 0 });
    tcpGateway.start(0, "127.0.0.1");
    await new Promise((r) => setTimeout(r, 50));
    const port = tcpGateway.address();
    expect(typeof port).toBe("number");
    const tcpWs = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.push(tcpWs);
    await opened(tcpWs);
    const tcp = await measure(tcpWs);

    // UDS arm — a SEPARATE gateway; start() after startOnSocket() is refused.
    gateway = createPiGateway(createMemorySessionManager(), { pingInterval: 0 });
    await gateway.startOnSocket(sockPath);
    const udsWs = dial();
    await opened(udsWs);
    const uds = await measure(udsWs);

    tcpGateway.stop();

    // Guard against a vacuous pass: an arm that never round-tripped would
    // report a p95 of 0 and trivially satisfy the ratio.
    expect(tcp.length).toBe(ROUNDS);
    expect(uds.length).toBe(ROUNDS);
    expect(p95(tcp)).toBeGreaterThan(0);
    expect(p95(uds)).toBeGreaterThan(0);

    // Floor the comparison: at sub-millisecond latencies scheduler noise
    // dominates, and a 20% ratio on 0.05 ms is measuring the event loop.
    const floorMs = 0.5;
    expect(Math.max(p95(uds), floorMs)).toBeLessThanOrEqual(Math.max(p95(tcp), floorMs) * 1.2);
  }, 30_000);
});
