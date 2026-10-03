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
import { spawn } from "node:child_process";
import net from "node:net";
import properLockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { WsTicketStore } from "../auth/ws-ticket.js";
import { startGatewayListeners } from "../pi/gateway-listeners.js";
import { probeSocket } from "../pi/gateway-socket-bind.js";
import { createPiGateway } from "../pi/pi-gateway.js";
import { buildSpawnEnv, setSpawnDashboardPiPort, setSpawnGatewayTransport } from "../spawn-process/process-manager.js";
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
      if (!fs.existsSync(sockPath) && !fs.existsSync(`${sockPath}.pid`)) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(fs.existsSync(sockPath)).toBe(false);
    expect(fs.existsSync(`${sockPath}.pid`)).toBe(false);
    // The bind-lock sentinel is deliberately LEFT: deleting it while a
    // competitor holds it would break mutual exclusion (D4, test-plan #X10).
    expect(fs.existsSync(`${sockPath}.lock`)).toBe(true);
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
  const median = (sorted: number[]) => sorted[Math.floor(sorted.length * 0.5)];

  it("UDS round-trip is not materially slower than TCP", async () => {
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

    // MEDIAN, not p95, and a wide ratio — deliberately loosened after this
    // assertion failed on CI at 17.8 ms vs 16.9 ms. A local ping/pong does not
    // take 17 ms: on a shared 2-core runner both arms are dominated by
    // scheduler noise, so a 20% p95 ratio was measuring the runner rather than
    // the transport, and would keep flipping colour for reasons unrelated to
    // the change.
    //
    // The bound is wide on EVIDENCE, not convenience (design.md D10d). Measured
    // off-CI, interleaved, same ws library both arms: UDS is ~54% faster at
    // 64 B and ~37-45% faster at 1-4 KB, but ~13-33% SLOWER at 64-256 KB. The
    // sign flips at ~8 KB because that is Darwin's unix socket buffer
    // (net.local.stream.sendspace) against TCP's 131072 — a kernel tunable, not
    // a property of the transport, and Linux differs. So a tight ratio here
    // would encode one platform's buffer sizes and one payload size as a
    // correctness requirement. What P4 must catch is UDS falling onto a SLOW
    // PATH, which is order-of-magnitude; the honest transport delta is tens of
    // microseconds and changes sign with payload.
    //
    // The median rejects that tail, and 2x still catches the regression this
    // exists to catch — UDS silently falling onto a slow path is an
    // order-of-magnitude event, not a 20% one. Tightening it back requires a
    // dedicated runner, not a smaller number.
    const floorMs = 0.5;
    expect(Math.max(median(uds), floorMs)).toBeLessThanOrEqual(Math.max(median(tcp), floorMs) * 2);
  }, 30_000);
});

// ── D5 must survive the SHIPPED transport combination ──────────────────────
//
// The container publishes TCP (`PI_GATEWAY_TCP=1`, task 8.6) AND serves the
// socket. Both transports deliberately share one `WebSocketServer` (D10/task
// 8.2) — but `verifyClient` is a property of that SERVER, so the TCP bridge
// gate silently applied to socket upgrades too, and every in-container bridge
// dialling the socket was answered `401`. The exemption looked correct in the
// source (`startOnSocket` attaches no gate) and was correct in isolation; only
// the combination broke it, and only the deployment runs the combination.
//
// Found by qa/tests/27-docker-deploy-lifecycle.sh against the real image.
// See change: add-pi-gateway-transport-identity (D5, task 8.2).
describe("unix socket transport alongside an authenticated TCP listener", () => {
  it("still accepts a socket bridge — the kernel already decided (D5)", async () => {
    const sessionManager = createMemorySessionManager();
    let refusals = 0;
    gateway = createPiGateway(sessionManager, {
      pingInterval: 0,
      bridgeAuth: {
        // The container's shape: no ticket, no local token, nothing minted.
        requireTicketOnLoopback: true,
        consumeTicket: () => ({ ok: false, reason: "missing" }) as const,
        verifyLocalToken: () => false,
        log: () => {
          refusals += 1;
        },
      },
    });
    // The shipped order — TCP first, then the socket (start() refuses the
    // reverse outright).
    const tcpPort = 19_099;
    gateway.start(tcpPort, "127.0.0.1");
    await gateway.startOnSocket(sockPath);

    const ws = dial();
    await opened(ws);

    ws.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "00000000-0000-4000-8000-0000000000d5",
        cwd: "/tmp",
        name: "socket-peer",
      }),
    );
    for (let i = 0; i < 100 && !gateway.isSessionConnected("00000000-0000-4000-8000-0000000000d5"); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(gateway.isSessionConnected("00000000-0000-4000-8000-0000000000d5")).toBe(true);
    expect(refusals).toBe(0);
    // …and is LOCAL. The shared server also shares the handler's transport
    // label, so a socket peer was attributed as remote — which shows an origin
    // chip and withholds Resume/Fork for every in-container session.
    expect(
      sessionManager.get("00000000-0000-4000-8000-0000000000d5")?.originDeviceId,
    ).toBeUndefined();
  });

  it("still refuses an unauthenticated TCP bridge on the same server", async () => {
    // The exemption must be scoped to the socket, not a hole in the gate.
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, {
      pingInterval: 0,
      bridgeAuth: {
        requireTicketOnLoopback: true,
        consumeTicket: () => ({ ok: false, reason: "missing" }) as const,
        verifyLocalToken: () => false,
        log: () => {},
      },
    });
    const tcpPort = 19_098;
    gateway.start(tcpPort, "127.0.0.1");
    await gateway.startOnSocket(sockPath);

    const ws = new WebSocket(`ws://127.0.0.1:${tcpPort}`);
    sockets.push(ws);
    await expect(opened(ws)).rejects.toThrow(/401|Unexpected server response/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// fix-gateway-socket-stale-owner: a refused / unusable socket degrades to an
// AUTHENTICATED loopback listener instead of aborting (D5, D6).
// (test-plan #X1–#X9, #X14)
// ──────────────────────────────────────────────────────────────────────────
describe("loopback fallback (fix-gateway-socket-stale-owner)", () => {
  const TOKEN = "test-local-token";
  const gateways: Array<ReturnType<typeof createPiGateway>> = [];
  const servers: net.Server[] = [];
  const clients: WebSocket[] = [];
  const tickets = new WsTicketStore();
  const log = { warn: vi.fn(), error: vi.fn() };

  const mk = (over: { requireTicketOnLoopback?: boolean } = {}) => {
    const g = createPiGateway(createMemorySessionManager(), {
      pingInterval: 0,
      bridgeAuth: {
        consumeTicket: (t) => tickets.consumeDetailed(t, "bridge"),
        requireTicketOnLoopback: over.requireTicketOnLoopback ?? false,
        verifyLocalToken: (h) => h?.["x-pi-local-token"] === TOKEN,
        log: () => {},
      },
    });
    gateways.push(g);
    return g;
  };

  const freePort = () =>
    new Promise<number>((resolve) => {
      const srv = net.createServer().listen(0, "127.0.0.1", () => {
        const port = (srv.address() as net.AddressInfo).port;
        srv.close(() => resolve(port));
      });
    });

  const hold = (target: string | number, host?: string) =>
    new Promise<net.Server>((resolve, reject) => {
      const srv = net.createServer((c) => c.destroy());
      servers.push(srv);
      srv.once("error", reject);
      if (typeof target === "number") srv.listen(target, host, () => resolve(srv));
      else srv.listen(target, () => resolve(srv));
    });

  async function staleSocket(p: string): Promise<void> {
    const child = spawn(process.execPath, [
      "-e",
      `require('net').createServer().listen(${JSON.stringify(p)},()=>console.log('up'))`,
    ]);
    await new Promise<void>((r, j) => {
      child.stdout.once("data", () => r());
      child.once("error", j);
    });
    child.kill("SIGKILL");
    await new Promise<void>((r) => child.once("exit", () => r()));
  }

  const dialTcp = (port: number, headers: Record<string, string> = {}) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
    clients.push(ws);
    return ws;
  };
  const outcome = (ws: WebSocket) =>
    new Promise<"open" | "refused">((resolve) => {
      ws.once("open", () => resolve("open"));
      ws.once("error", () => resolve("refused"));
      ws.once("unexpected-response", () => resolve("refused"));
    });
  const register = async (ws: WebSocket, id: string) => {
    ws.send(JSON.stringify({ type: "session_register", sessionId: id, cwd: tmp, pid: process.pid }));
  };
  const waitConnected = async (g: ReturnType<typeof createPiGateway>, id: string) => {
    for (let i = 0; i < 100 && !g.isSessionConnected(id); i++) await new Promise((r) => setTimeout(r, 10));
    return g.isSessionConnected(id);
  };

  afterEach(async () => {
    for (const c of clients.splice(0)) c.terminate();
    for (const g of gateways.splice(0)) g.stop();
    for (const sv of servers.splice(0)) await new Promise<void>((r) => sv.close(() => r()));
    setSpawnDashboardPiPort(null);
    setSpawnGatewayTransport(null);
    log.warn.mockClear();
    log.error.mockClear();
  });

  const socketOnly = () => ({ socketPath: sockPath, reason: "test" });

  // X1
  it("a live incumbent keeps serving while we serve an authenticated loopback listener", async () => {
    await hold(sockPath);
    fs.writeFileSync(`${sockPath}.pid`, "4242\n");
    const port = await freePort();
    const g = mk();
    await startGatewayListeners(g, socketOnly(), { piPort: port, log });

    expect(g.bridgeListeners()).toEqual({ listeners: ["loopback-fallback"], fallbackReason: "occupied" });
    const ws = dialTcp(port, { "x-pi-local-token": TOKEN });
    expect(await outcome(ws)).toBe("open");
    await expect(probeSocket(sockPath)).resolves.toBe("live");
    const logged = log.error.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain(sockPath);
    expect(logged).toContain("verdict=live");
    expect(logged).toContain("4242");
  });

  // X2 — the #744 repro end to end
  it("reclaims a stale socket whose pidfile names this very process", async () => {
    await staleSocket(sockPath);
    fs.writeFileSync(`${sockPath}.pid`, `${process.pid}\n`);
    const port = await freePort();
    const g = mk();
    await startGatewayListeners(g, socketOnly(), { piPort: port, log });
    expect(g.transport()).toEqual({ transport: "unix", path: sockPath });
    const ws = new WebSocket(`ws+unix://${sockPath}:/`);
    clients.push(ws);
    expect(await outcome(ws)).toBe("open");
    expect(await new Promise<boolean>((r) => net.connect(port, "127.0.0.1").once("connect", () => r(true)).once("error", () => r(false)))).toBe(false);
  });

  // X3
  it("aborts naming the socket path and the port when the fallback port is taken", async () => {
    await hold(sockPath);
    const port = await freePort();
    await hold(port, "127.0.0.1");
    const g = mk();
    const err = await startGatewayListeners(g, socketOnly(), { piPort: port, log }).catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).toContain(sockPath);
    expect(String(err)).toContain(String(port));
    expect(g.bridgeListeners().listeners).toEqual([]);
  });

  // X4
  it.skipIf(process.getuid?.() === 0)("aborts without a fallback on a permission error", async () => {
    const ro = path.join(tmp, "ro");
    fs.mkdirSync(ro, { mode: 0o500 });
    const port = await freePort();
    const g = mk();
    try {
      const err = await startGatewayListeners(
        g,
        { socketPath: path.join(ro, "sub", "gw.sock"), reason: "t" },
        { piPort: port, log },
      ).catch((e) => e as Error);
      expect(String(err)).toMatch(/EACCES/);
      expect(String(err)).toContain(path.join(ro, "sub", "gw.sock"));
      expect(g.bridgeListeners().listeners).toEqual([]);
    } finally {
      fs.chmodSync(ro, 0o700);
    }
  });
  it("aborts without a fallback when the bind lock cannot be taken", async () => {
    fs.writeFileSync(`${sockPath}.lock`, "x");
    const release = await properLockfile.lock(`${sockPath}.lock`, { stale: 60_000 });
    try {
      const port = await freePort();
      const g = mk();
      const err = await startGatewayListeners(g, socketOnly(), { piPort: port, log }).catch((e) => e as Error);
      expect(String(err)).toMatch(/lock/i);
      expect(g.bridgeListeners().listeners).toEqual([]);
    } finally {
      await release();
    }
  }, 20_000);

  // X5
  it("falls back as 'unsupported' when the filesystem cannot host a unix socket", async () => {
    const port = await freePort();
    const g = mk();
    vi.spyOn(g, "startOnSocket").mockRejectedValue(Object.assign(new Error("nope"), { code: "EOPNOTSUPP" }));
    await startGatewayListeners(g, socketOnly(), { piPort: port, log });
    expect(g.bridgeListeners()).toEqual({ listeners: ["loopback-fallback"], fallbackReason: "unsupported" });
  });

  // X6
  it("with the TCP opt-in a socket failure keeps TCP serving", async () => {
    await hold(sockPath);
    const port = await freePort();
    const g = mk();
    await startGatewayListeners(g, { socketPath: sockPath, tcp: { host: "127.0.0.1", port }, reason: "t" }, { piPort: port, log });
    expect(g.bridgeListeners().listeners).toEqual(["tcp"]);
    expect(await outcome(dialTcp(port, { "x-pi-local-token": TOKEN }))).toBe("open");
    expect(log.error.mock.calls.map((c) => String(c[0])).join()).toContain(sockPath);

    const g2 = mk();
    const port2 = await freePort();
    vi.spyOn(g2, "startOnSocket").mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" }));
    await startGatewayListeners(g2, { socketPath: sockPath, tcp: { host: "127.0.0.1", port: port2 }, reason: "t" }, { piPort: port2, log });
    expect(await outcome(dialTcp(port2, { "x-pi-local-token": TOKEN }))).toBe("open");
  });

  // E10 — what /api/health reports, per gateway state
  it("bridgeListeners() names every active listener", async () => {
    const a = mk();
    await a.startOnSocket(sockPath);
    expect(a.bridgeListeners()).toEqual({ listeners: ["unix"] });

    const b = mk();
    const bSock = path.join(tmp, "b.sock");
    await startGatewayListeners(b, { socketPath: bSock, tcp: { host: "127.0.0.1", port: await freePort() }, reason: "t" }, { piPort: 1, log });
    expect(b.bridgeListeners()).toEqual({ listeners: ["unix", "tcp"] });

    const c = mk();
    c.start(await freePort(), "127.0.0.1", { kind: "loopback" });
    expect(c.bridgeListeners()).toEqual({ listeners: ["loopback"] });
  });

  // X7
  it("transport() and address() never throw after a failed socket bind", async () => {
    await hold(sockPath);
    const g = mk();
    await expect(g.startOnSocket(sockPath)).rejects.toBeTruthy();
    expect(() => g.transport()).not.toThrow();
    expect(() => g.address()).not.toThrow();
    expect(g.transport()).toBeNull();
  });

  // X8
  it("the fallback refuses a bridge without the local token or a ticket", async () => {
    const port = await freePort();
    const g = mk();
    await g.startLoopbackFallback(port, "occupied");

    const none = dialTcp(port);
    expect(await outcome(none)).toBe("refused");
    const wrong = dialTcp(port, { "x-pi-local-token": "wrong" });
    expect(await outcome(wrong)).toBe("refused");
    expect(g.connectionCount()).toBe(0);

    const good = dialTcp(port, { "x-pi-local-token": TOKEN });
    expect(await outcome(good)).toBe("open");
    await register(good, "fb-token");
    expect(await waitConnected(g, "fb-token")).toBe(true);

    const ticketed = new WebSocket(`ws://127.0.0.1:${port}/?ticket=${tickets.mint("bridge")}`);
    clients.push(ticketed);
    expect(await outcome(ticketed)).toBe("open");
  });

  // X9
  it("the no-grace rule is per listener: opt-in TCP keeps its tokenless grace", async () => {
    const optInPort = await freePort();
    const opt = mk({ requireTicketOnLoopback: false });
    opt.start(optInPort, "127.0.0.1");
    expect(await outcome(dialTcp(optInPort))).toBe("open");

    const fbPort = await freePort();
    const fb = mk({ requireTicketOnLoopback: false });
    await fb.startLoopbackFallback(fbPort, "occupied");
    expect(await outcome(dialTcp(fbPort))).toBe("refused");
  });

  it("the fallback refuses to start without a bridge-auth gate", async () => {
    const g = createPiGateway(createMemorySessionManager(), { pingInterval: 0 });
    gateways.push(g);
    await expect(g.startLoopbackFallback(await freePort(), "occupied")).rejects.toThrow(/bridge auth/);
  });

  // X14
  it("a session spawned after a fallback registers with the fallback gateway, not the incumbent", async () => {
    const incumbent = mk();
    await incumbent.startOnSocket(sockPath);
    const port = await freePort();
    const fb = mk();
    await startGatewayListeners(fb, socketOnly(), { piPort: port, log });

    setSpawnDashboardPiPort(port);
    setSpawnGatewayTransport(() => {
      const t = fb.transport();
      return fb.bridgeListeners().listeners.includes("loopback-fallback") || t?.transport !== "unix"
        ? { transport: "loopback-fallback" }
        : { transport: "unix", path: t.path };
    });
    const env = buildSpawnEnv({ PATH: "/usr/bin", PI_DASHBOARD_SOCKET: sockPath });
    expect(env.PI_DASHBOARD_SOCKET).toBeUndefined();
    expect(env.PI_DASHBOARD_URL).toBe(`ws://127.0.0.1:${port}`);

    const ws = new WebSocket(env.PI_DASHBOARD_URL as string, { headers: { "x-pi-local-token": TOKEN } });
    clients.push(ws);
    expect(await outcome(ws)).toBe("open");
    await register(ws, "spawned-1");
    expect(await waitConnected(fb, "spawned-1")).toBe(true);
    expect(incumbent.isSessionConnected("spawned-1")).toBe(false);
  });
});
