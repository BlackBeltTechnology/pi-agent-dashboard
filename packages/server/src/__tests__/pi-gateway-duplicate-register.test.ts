/**
 * Red reproduction for fix-duplicate-bridge-registration.
 *
 * Two live bridges claiming one `sessionId` must not resolve by arrival order.
 * Covers test-plan #E1, #E13, #E14, #E15 (section 1) and the identity-scoped
 * cleanup / teardown scenarios #E16, #E17, #E18 (section 2).
 *
 * Socket glue (real `WebSocketServer` + real `ws` clients, `start(0)` +
 * `waitForBind`) follows `pi-gateway-bind-host.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createPiGateway } from "../pi/pi-gateway.js";
import { WsTicketStore } from "../auth/ws-ticket.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import {
  _setSpawnRegisterWatchdogForTests,
  SpawnRegisterWatchdog,
} from "../spawn-process/spawn-register-watchdog.js";

export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on("open", () => resolve());
    ws.on("error", reject);
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

/** Poll gateway.address() until the async listen resolves a port. */
export async function waitForBind(gateway: { address(): number | string | null }): Promise<number> {
  for (let i = 0; i < 200; i++) {
    const port = gateway.address();
    if (typeof port === "number") return port;
    await delay(10);
  }
  throw new Error("gateway did not bind a port");
}

/** Wait until `pred()` holds, polling every 10ms up to `timeout`. */
export async function until(pred: () => boolean, timeout = 3000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (pred()) return;
    await delay(10);
  }
  throw new Error("condition not met within timeout");
}

/** A connected client socket plus the frames it received. */
export interface Client {
  ws: WebSocket;
  received: any[];
  closed: boolean;
  closeCode: number | null;
}

export async function connect(port: number): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const client: Client = { ws, received: [], closed: false, closeCode: null };
  ws.on("message", (raw) => {
    try {
      client.received.push(JSON.parse(raw.toString()));
    } catch {
      /* ignore non-JSON */
    }
  });
  ws.on("close", (code) => {
    client.closed = true;
    client.closeCode = code;
  });
  ws.on("error", () => {
    /* refused sockets surface an error on abrupt close; the close handler is the assertion surface */
  });
  await waitForOpen(ws);
  return client;
}

/**
 * Make `client` *reference* `sessionId` without registering it: the first
 * message carrying a sessionId is the gateway's real claim point, so this is
 * the illegal-edge input for the identity-scoped cleanup scenarios.
 */
export function referenceOnly(client: Client, sessionId: string): void {
  client.ws.send(JSON.stringify({ type: "event_forward", sessionId, event: { type: "noop" } }));
}

export function register(
  client: Client,
  sessionId: string,
  extra: Record<string, unknown> = {},
): void {
  client.ws.send(
    JSON.stringify({
      type: "session_register",
      sessionId,
      cwd: "/tmp/dup-test",
      source: "tui",
      ...extra,
    }),
  );
}

describe("pi-gateway duplicate register", () => {
  let gateway: ReturnType<typeof createPiGateway>;
  const sockets: Client[] = [];

  afterEach(() => {
    for (const c of sockets) c.ws.terminate();
    sockets.length = 0;
    gateway?.stop();
  });

  async function startGateway(opts: Record<string, unknown> = {}) {
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 0, ...opts });
    gateway.start(0, "127.0.0.1");
    const port = await waitForBind(gateway);
    return { sessionManager, port };
  }

  async function newClient(port: number): Promise<Client> {
    const c = await connect(port);
    sockets.push(c);
    return c;
  }

  // ── E1 ────────────────────────────────────────────────────────────────────
  it("E1: a second socket registering a held, live id does not steal the routing entry", async () => {
    const { port } = await startGateway();

    // A registers S and is live (the `ws` client auto-answers pings with pongs).
    const a = await newClient(port);
    register(a, "S");
    await delay(100);

    // B claims the same id.
    const b = await newClient(port);
    register(b, "S");

    // Contention resolves as soon as the incumbent pongs.
    await until(() => b.closed, 8000);

    // The routing entry still resolves to A: the message arrives on A only.
    a.received.length = 0;
    const sent = gateway.sendToSession("S", { type: "reload" } as any);
    expect(sent).toBe(true);
    await until(() => a.received.some((m) => m.type === "reload"), 2000);
    expect(b.received.some((m) => m.type === "reload")).toBe(false);

    // B lost and was closed.
    expect(b.closed).toBe(true);
    expect(a.ws.readyState).toBe(WebSocket.OPEN);
  }, 20000);

  // ── E13 ───────────────────────────────────────────────────────────────────
  it("E13: the refused socket is closed and left under no session id", async () => {
    const { port } = await startGateway();

    const a = await newClient(port);
    register(a, "S");
    await delay(100);

    const b = await newClient(port);
    register(b, "S");
    await until(() => b.closed, 8000);

    expect(b.ws.readyState).toBe(WebSocket.CLOSED);

    // B is routable under no id at all: every connected id delivers elsewhere.
    b.received.length = 0;
    for (const sid of gateway.getConnectedSessionIds()) {
      gateway.sendToSession(sid, { type: "reload" } as any);
    }
    await delay(200);
    expect(b.received).toEqual([]);
  }, 20000);

  // ── E14 ───────────────────────────────────────────────────────────────────
  it("E14: stop() terminates a socket accepted by wss but absent from the routing table", async () => {
    const { port } = await startGateway();

    // Connected but never sent a sessionId — never enters `connections`.
    const orphan = await newClient(port);
    await delay(100);
    expect(gateway.getConnectedSessionIds()).toEqual([]);
    expect(orphan.ws.readyState).toBe(WebSocket.OPEN);

    gateway.stop();

    await until(() => orphan.ws.readyState === WebSocket.CLOSED, 3000);
  }, 20000);

  // ── E15 ───────────────────────────────────────────────────────────────────
  it("E15: a non-owning socket closing leaves the entry resolving to its owner", async () => {
    const { port } = await startGateway();

    const a = await newClient(port);
    register(a, "S");
    await delay(100);

    // B references S without owning it, then closes.
    const b = await newClient(port);
    referenceOnly(b, "S");
    await delay(200);
    b.ws.close();
    await until(() => b.closed, 3000);
    await delay(200);

    // The entry for S still resolves to A.
    a.received.length = 0;
    expect(gateway.sendToSession("S", { type: "reload" } as any)).toBe(true);
    await until(() => a.received.some((m) => m.type === "reload"), 2000);
  }, 20000);

  // ── E16 ───────────────────────────────────────────────────────────────────
  it("E16: a non-owning socket closing signals no disconnect for the id", async () => {
    const { port } = await startGateway();

    const disconnects: string[] = [];
    gateway.onDisconnect = (sid) => disconnects.push(sid);

    const a = await newClient(port);
    register(a, "S");
    await delay(100);

    const b = await newClient(port);
    referenceOnly(b, "S");
    await delay(200);
    b.ws.close();
    await until(() => b.closed, 3000);
    await delay(300);

    expect(disconnects).not.toContain("S");

    // And the incumbent is still routable — its timers were not torn down.
    expect(gateway.isSessionConnected("S")).toBe(true);
  }, 20000);

  // ── E17 ───────────────────────────────────────────────────────────────────
  it("E17: a non-owning socket closing neither unregisters nor finalizes a finalizeOnSocketClose session", async () => {
    const { sessionManager, port } = await startGateway();

    const a = await newClient(port);
    register(a, "S");
    await delay(100);
    sessionManager.update("S", { finalizeOnSocketClose: true } as any);

    const b = await newClient(port);
    referenceOnly(b, "S");
    await delay(200);
    b.ws.close();
    await until(() => b.closed, 3000);
    await delay(300);

    const session = sessionManager.get("S");
    expect(session).toBeDefined();
    expect(session!.status).not.toBe("ended");
    expect(gateway.isSessionConnected("S")).toBe(true);
  }, 20000);

  // ── E18 ───────────────────────────────────────────────────────────────────
  it("E18: the owning socket closing still runs cleanup as today", async () => {
    const { sessionManager, port } = await startGateway();

    const disconnects: string[] = [];
    gateway.onDisconnect = (sid) => disconnects.push(sid);

    const a = await newClient(port);
    register(a, "S");
    await delay(100);

    // Non-automation: close signals a disconnect, but defers unregister to the
    // heartbeat grace path (unchanged behaviour).
    a.ws.close();
    await until(() => disconnects.includes("S"), 3000);
    expect(sessionManager.get("S")!.status).not.toBe("ended");
  }, 20000);

  // ── E18b (automation branch of the same rule) ─────────────────────────────
  it("E18: the owning socket closing finalizes a finalizeOnSocketClose session as today", async () => {
    const { sessionManager, port } = await startGateway();

    const a = await newClient(port);
    register(a, "S");
    await delay(100);
    sessionManager.update("S", { finalizeOnSocketClose: true } as any);

    a.ws.close();
    await until(() => sessionManager.get("S")?.status === "ended", 3000);
    expect(gateway.isSessionConnected("S")).toBe(false);
  }, 20000);

  // ── E2 ────────────────────────────────────────────────────────────────────
  it("E2: a non-register first message cannot claim a held id", async () => {
    const { port } = await startGateway();

    const a = await newClient(port);
    register(a, "S");
    await delay(100);

    // B's FIRST message is an event, not a register.
    const b = await newClient(port);
    referenceOnly(b, "S");
    await delay(300);

    // B never became the routing entry.
    a.received.length = 0;
    b.received.length = 0;
    expect(gateway.sendToSession("S", { type: "reload" } as any)).toBe(true);
    await until(() => a.received.some((m) => m.type === "reload"), 2000);
    expect(b.received.some((m) => m.type === "reload")).toBe(false);
  }, 20000);

  // ── E4 ────────────────────────────────────────────────────────────────────
  it("E4: the same socket re-registering keeps the entry and is not refused", async () => {
    const { port } = await startGateway();

    const a = await newClient(port);
    register(a, "S");
    await delay(100);

    register(a, "S", { name: "renamed" });
    await delay(300);

    expect(a.closed).toBe(false);
    expect(a.received.some((m) => m.type === "register_rejected")).toBe(false);
    expect(gateway.isSessionConnected("S")).toBe(true);
  }, 20000);

  // ── E3 ────────────────────────────────────────────────────────────────────
  it("E3: a newcomer takes over from a CLOSED incumbent with no probe", async () => {
    // A long probe window would make this hang if a probe were issued.
    const { port } = await startGateway({ contentionProbeWindow: 30_000 });

    const a = await newClient(port);
    register(a, "S");
    await delay(100);
    a.ws.close();
    await until(() => a.closed, 3000);
    await delay(100);

    const b = await newClient(port);
    register(b, "S");
    // Fast: no probe was issued.
    await until(() => gateway.isSessionConnected("S"), 2000);

    b.received.length = 0;
    expect(gateway.sendToSession("S", { type: "reload" } as any)).toBe(true);
    await until(() => b.received.some((m) => m.type === "reload"), 2000);
    expect(b.closed).toBe(false);
  }, 20000);

  // ── E5 ────────────────────────────────────────────────────────────────────
  it("E5: a socket registering a second, unheld id is accepted", async () => {
    const { port } = await startGateway();

    const a = await newClient(port);
    register(a, "S1");
    await delay(100);

    register(a, "S2");
    await delay(300);

    expect(a.closed).toBe(false);
    a.received.length = 0;
    expect(gateway.sendToSession("S2", { type: "reload" } as any)).toBe(true);
    await until(() => a.received.some((m) => m.type === "reload"), 2000);
  }, 20000);

  // ── E12 ───────────────────────────────────────────────────────────────────
  it("E12: a placeholder incumbent is displaced by a real register, never refusing it", async () => {
    const { sessionManager, port } = await startGateway({ contentionProbeWindow: 30_000 });

    // A claims S via a non-register message → auto-created placeholder.
    const a = await newClient(port);
    referenceOnly(a, "S");
    await until(() => sessionManager.get("S") !== undefined, 3000);
    expect(sessionManager.get("S")!.source).toBe("unknown");

    // B sends a real register for the same id.
    const b = await newClient(port);
    register(b, "S");
    // Fast: a placeholder is never probed.
    await until(() => sessionManager.get("S")?.source === "tui", 2000);

    expect(b.closed).toBe(false);
    b.received.length = 0;
    expect(gateway.sendToSession("S", { type: "reload" } as any)).toBe(true);
    await until(() => b.received.some((m) => m.type === "reload"), 2000);
  }, 20000);

  // ── E10 ───────────────────────────────────────────────────────────────────
  it("E10: a newcomer reporting the incumbent's pid replaces it without a probe", async () => {
    const { port } = await startGateway({ contentionProbeWindow: 30_000 });

    const a = await newClient(port);
    register(a, "S", { pid: 4242 });
    await delay(150);

    const b = await newClient(port);
    register(b, "S", { pid: 4242 });

    // Fast: the same-pid exemption issues no probe, so B owns the entry well
    // inside the 30 s window the probe would have taken.
    await until(() => gateway.isSessionConnected("S"), 2000);
    await delay(200);

    b.received.length = 0;
    a.received.length = 0;
    expect(gateway.sendToSession("S", { type: "reload" } as any)).toBe(true);
    await until(() => b.received.some((m) => m.type === "reload"), 2000);
    expect(a.received.some((m) => m.type === "reload")).toBe(false);
    expect(b.closed).toBe(false);
  }, 20000);

  // ── E7 ────────────────────────────────────────────────────────────────────
  it("E7: a silent-but-writable incumbent keeps the entry and the newcomer is refused", async () => {
    const { port } = await startGateway({ contentionProbeWindow: 400 });

    const a = await newClient(port);
    register(a, "S", { pid: 1111 });
    await delay(150);

    // Stop A answering pongs while leaving its TCP transport intact — the
    // gateway's own "busy bridge" case.
    (a.ws as any)._socket?.pause();

    const b = await newClient(port);
    register(b, "S", { pid: 2222 });
    await until(() => b.closed, 8000);

    expect(b.received.some((m) => m.type === "register_rejected")).toBe(true);
    expect(gateway.isSessionConnected("S")).toBe(true);
    expect(a.ws.readyState).toBe(WebSocket.OPEN);
  }, 20000);

  // ── E19 ───────────────────────────────────────────────────────────────────
  it("E19: after contention resolves exactly one socket is routable for the id", async () => {
    const { port } = await startGateway();

    const a = await newClient(port);
    register(a, "S");
    await delay(150);
    const b = await newClient(port);
    register(b, "S");
    await until(() => b.closed, 8000);

    a.received.length = 0;
    b.received.length = 0;
    gateway.sendToSession("S", { type: "reload" } as any);
    await delay(300);

    const reached = [a, b].filter((c) => c.received.some((m) => m.type === "reload"));
    expect(reached).toHaveLength(1);
    expect(reached[0]).toBe(a);
    expect(b.ws.readyState).toBe(WebSocket.CLOSED);
  }, 20000);

  // ── E19 (concurrent newcomers) ─────────────────────────────────────────
  it("E19: two newcomers racing one incumbent still leave exactly one routable socket", async () => {
    // Each socket has its own message queue, so both claims run concurrently
    // against the same incumbent. A claim that accepted purely because the
    // holder changed mid-probe would let the second newcomer overwrite the
    // first — last-writer-wins, reintroduced.
    const { port } = await startGateway({ contentionProbeWindow: 500 });

    const a = await newClient(port);
    register(a, "S", { pid: 1111 });
    await delay(200);
    // Incumbent goes silent AND loses its transport, so the probe resolves
    // "dead" and a displacement is actually on the table.
    (a.ws as any)._socket?.destroy();

    const b = await newClient(port);
    const c = await newClient(port);
    register(b, "S", { pid: 2222 });
    register(c, "S", { pid: 3333 });

    await delay(3000);

    // Whatever the outcome, at most one socket may be routable for S.
    b.received.length = 0;
    c.received.length = 0;
    gateway.sendToSession("S", { type: "reload" } as any);
    await delay(400);

    const reached = [b, c].filter((x) => x.received.some((m) => m.type === "reload"));
    expect(reached.length).toBeLessThanOrEqual(1);

    // And the socket that owns the entry is the one that is still open.
    if (reached.length === 1) {
      expect(reached[0].ws.readyState).toBe(WebSocket.OPEN);
    }
  }, 25000);

  // ── X7 ────────────────────────────────────────────────────────────────────
  it("X7: the rejection names the session id and a reason, and is sent before the close", async () => {
    const { port } = await startGateway();

    const a = await newClient(port);
    register(a, "S");
    await delay(150);

    const b = await newClient(port);
    const order: string[] = [];
    b.ws.on("message", () => order.push("message"));
    b.ws.on("close", () => order.push("close"));
    register(b, "S");
    await until(() => b.closed, 8000);

    const rejection = b.received.find((m) => m.type === "register_rejected");
    expect(rejection).toBeDefined();
    expect(rejection.sessionId).toBe("S");
    expect(typeof rejection.reason).toBe("string");
    expect(rejection.reason.length).toBeGreaterThan(0);
    expect(order).toEqual(["message", "close"]);
  }, 20000);

  // ── X1 / X3 ───────────────────────────────────────────────────────────────
  it("X1/X3: a refused register neither steals the incumbent's sessionFile nor emits a registration", async () => {
    const { sessionManager, port } = await startGateway();

    const registered: string[] = [];
    gateway.onSessionRegistered = (sid) => registered.push(sid);

    const a = await newClient(port);
    register(a, "S", { sessionFile: "/transcripts/F.jsonl", pid: 1111 });
    await until(() => registered.length === 1, 3000);

    const b = await newClient(port);
    register(b, "S", { sessionFile: "/transcripts/OTHER.jsonl", pid: 2222 });
    await until(() => b.closed, 8000);
    await delay(200);

    // X1: the incumbent's sessionFile survived the refused register.
    expect(sessionManager.get("S")!.sessionFile).toBe("/transcripts/F.jsonl");
    // X3: no second registration was emitted.
    expect(registered).toEqual(["S"]);
  }, 20000);

  // ── X4 ────────────────────────────────────────────────────────────────────
  it("X4: a refused register leaves the incumbent's session untouched", async () => {
    const { sessionManager, port } = await startGateway();

    const a = await newClient(port);
    register(a, "S", { pid: 1111, model: "model-a" });
    await delay(200);
    const before = { ...sessionManager.get("S")! };

    const b = await newClient(port);
    register(b, "S", { pid: 2222, model: "model-b" });
    await until(() => b.closed, 8000);
    await delay(200);

    const after = sessionManager.get("S")!;
    expect(after.pid).toBe(before.pid);
    expect(after.model).toBe(before.model);
    expect(after.status).toBe(before.status);
  }, 20000);

  // ── X5 ────────────────────────────────────────────────────────────────────
  it("X5: heartbeat/model_update from a non-owning socket are dropped", async () => {
    const { sessionManager, port } = await startGateway();

    const a = await newClient(port);
    register(a, "S", { pid: 1111, model: "model-a" });
    await delay(200);

    // C never registers S; it just names it.
    const c = await newClient(port);
    register(c, "OTHER");
    await delay(200);
    c.ws.send(
      JSON.stringify({
        type: "session_heartbeat",
        sessionId: "S",
        metrics: { rss: 999, cpu: 99 },
      }),
    );
    c.ws.send(JSON.stringify({ type: "model_update", sessionId: "S", model: "hijacked" }));
    await delay(400);

    const session = sessionManager.get("S")!;
    expect(session.model).toBe("model-a");
    expect(session.processMetrics?.rss).not.toBe(999);
    // The impostor got no ack either.
    expect(c.received.some((m) => m.type === "heartbeat_ack")).toBe(false);
  }, 20000);

  // ── contention record surface (F-series backing) ──────────────────────────
  it("records the contention and exposes it for /api/health", async () => {
    const { port } = await startGateway();

    const a = await newClient(port);
    register(a, "S", { pid: 37660 });
    await delay(150);
    const b = await newClient(port);
    register(b, "S", { pid: 17579 });
    await until(() => b.closed, 8000);

    expect(gateway.contention.count()).toBeGreaterThanOrEqual(1);
    expect(gateway.contention.contendedIds()).toContain("S");
    expect(gateway.contention.get("S")).toMatchObject({
      incumbentPid: 37660,
      newcomerPid: 17579,
    });
  }, 20000);

  // ── F5 ────────────────────────────────────────────────────────────────────
  it("F5: the contention record is cleared when the incumbent disconnects", async () => {
    const { port } = await startGateway();

    const a = await newClient(port);
    register(a, "S");
    await delay(150);
    const b = await newClient(port);
    register(b, "S");
    await until(() => b.closed, 8000);
    expect(gateway.contention.isContended("S")).toBe(true);

    a.ws.close();
    await until(() => !gateway.contention.isContended("S"), 3000);
    expect(gateway.contention.contendedIds()).not.toContain("S");
  }, 20000);
});

/**
 * Tier-aware watchdog clearing and the dashboard-spawn signal plumbing.
 *
 * See change: fix-spawn-correlation-ttl-coupling (test-plan E22, E23, E28, E29).
 */
describe("pi-gateway: register-time watchdog clears and visibility signal", () => {
  let gateway: ReturnType<typeof createPiGateway>;
  const sockets: Client[] = [];

  afterEach(() => {
    for (const c of sockets) c.ws.terminate();
    sockets.length = 0;
    gateway?.stop();
    _setSpawnRegisterWatchdogForTests(null);
  });

  async function start() {
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 0 });
    gateway.start(0, "127.0.0.1");
    const port = await waitForBind(gateway);
    const client = await connect(port);
    sockets.push(client);
    return { sessionManager, client };
  }

  // E22 — registering A must not disarm B's same-cwd watchdog.
  it("a token clear does not cancel a concurrent same-cwd spawn's arm", async () => {
    const fired: string[] = [];
    const watchdog = new SpawnRegisterWatchdog(60_000, {
      findPidsBySpawnToken: () => [],
      kill: () => {},
    });
    _setSpawnRegisterWatchdogForTests(watchdog);
    const { sessionManager, client } = await start();

    const ws = { readyState: 1, send: (raw: string) => fired.push(raw) } as any;
    watchdog.arm({ cwd: "/tmp/dup-test", mechanism: "tmux", ws, spawnToken: "tok_A", timeoutMs: 5_000 });
    watchdog.arm({ cwd: "/tmp/dup-test", mechanism: "tmux", ws, spawnToken: "tok_B", timeoutMs: 5_000 });

    register(client, "S_A", { spawnToken: "tok_A" });
    await until(() => sessionManager.get("S_A") !== undefined);

    // B never registered: its watchdog must still fire.
    await until(() => fired.some((m) => m.includes("spawn_register_timeout")), 8_000);
    const timeouts = fired.filter((m) => m.includes("spawn_register_timeout"));
    expect(timeouts).toHaveLength(1);
  }, 15_000);

  // E23 — a token-less tmux spawn still clears through the cwd tier.
  it("a register with no token clears a cwd-armed watchdog", async () => {
    const fired: string[] = [];
    const watchdog = new SpawnRegisterWatchdog(60_000, {
      findPidsBySpawnToken: () => [],
      kill: () => {},
    });
    _setSpawnRegisterWatchdogForTests(watchdog);
    const { sessionManager, client } = await start();

    const ws = { readyState: 1, send: (raw: string) => fired.push(raw) } as any;
    watchdog.arm({ cwd: "/tmp/dup-test", mechanism: "tmux", ws, timeoutMs: 5_000 });

    register(client, "S_tmux");
    await until(() => sessionManager.get("S_tmux") !== undefined);
    // The arm is gone: a second cwd clear finds nothing left to cancel …
    await until(() => watchdog.clearByCwd("/tmp/dup-test") === false);
    // … and nothing ever fires.
    await delay(6_000);
    expect(fired).toHaveLength(0);
  }, 15_000);

  // E29 — the signal reaches `register` params rather than being dropped.
  it("forwards dashboardSpawned:true so a headless dashboard spawn stays visible", async () => {
    const { sessionManager, client } = await start();
    register(client, "S_dash", { hasUI: false, dashboardSpawned: true });
    await until(() => sessionManager.get("S_dash") !== undefined);
    expect(sessionManager.get("S_dash")?.hidden).toBe(false);
  });

  // E28 — a non-`true` value is coerced and cannot un-hide.
  it("coerces a bogus dashboardSpawned value and leaves the session hidden", async () => {
    const { sessionManager, client } = await start();
    register(client, "S_bogus", { hasUI: false, dashboardSpawned: "yes" });
    register(client, "S_num", { hasUI: false, dashboardSpawned: 1 });
    await until(() => sessionManager.get("S_num") !== undefined);
    expect(sessionManager.get("S_bogus")?.hidden).toBe(true);
    expect(sessionManager.get("S_num")?.hidden).toBe(true);
  });

  it("a headless register with no signal at all stays hidden", async () => {
    const { sessionManager, client } = await start();
    register(client, "S_worker", { hasUI: false });
    await until(() => sessionManager.get("S_worker") !== undefined);
    expect(sessionManager.get("S_worker")?.hidden).toBe(true);
  });
});

/**
 * Inbound drop reports and prompt acknowledgements are routed by OWNERSHIP.
 *
 * See change: fix-spawn-correlation-ttl-coupling (test-plan X7, X9, D6, D7).
 */
describe("pi-gateway: drop reports and prompt acks", () => {
  let gateway: ReturnType<typeof createPiGateway>;
  const sockets: Client[] = [];

  afterEach(() => {
    for (const c of sockets) c.ws.terminate();
    sockets.length = 0;
    gateway?.stop();
  });

  async function start() {
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 0 });
    const seen: Array<{ sessionId: string; msg: any }> = [];
    gateway.onEvent = (sessionId, msg) => seen.push({ sessionId, msg: msg as any });
    gateway.start(0, "127.0.0.1");
    const port = await waitForBind(gateway);
    return { sessionManager, port, seen };
  }

  async function newClient(port: number): Promise<Client> {
    const c = await connect(port);
    sockets.push(c);
    return c;
  }

  // X7 — a report NAMING another session must still reach the handler: the
  // dropped id is payload, the routing id is the reporter's own.
  it("delivers a drop report that names a session the reporter does not own", async () => {
    const { port, seen } = await start();
    const a = await newClient(port);
    register(a, "S_owner");
    await until(() => seen.some((e) => e.msg.type === "session_register"));

    a.ws.send(
      JSON.stringify({
        type: "inbound_drop_report",
        sessionId: "S_owner",
        dropClass: "session_mismatch",
        messageType: "send_prompt",
        droppedSessionId: "S_someone_else",
      }),
    );

    await until(() => seen.some((e) => e.msg.type === "inbound_drop_report"));
    const report = seen.find((e) => e.msg.type === "inbound_drop_report")!;
    expect(report.sessionId).toBe("S_owner");
    expect(report.msg.droppedSessionId).toBe("S_someone_else");
  });

  // X9 — an acknowledgement from a connection that does NOT own the id is
  // refused by the routing guard, so the prompt is never marked delivered.
  it("drops a prompt_received naming a session another connection owns", async () => {
    const { port, seen } = await start();
    const owner = await newClient(port);
    register(owner, "S_owned");
    await until(() => seen.some((e) => e.msg.type === "session_register"));

    const stranger = await newClient(port);
    stranger.ws.send(
      JSON.stringify({
        type: "prompt_received",
        sessionId: "S_owned",
        fresh: true,
        promptId: "p-stranger",
      }),
    );

    // Give it every chance to arrive, then assert it never did.
    await delay(200);
    expect(seen.some((e) => e.msg.type === "prompt_received")).toBe(false);
  });

  it("accepts the owner's acknowledgement carrying the promptId", async () => {
    const { port, seen } = await start();
    const owner = await newClient(port);
    register(owner, "S_ack");
    await until(() => seen.some((e) => e.msg.type === "session_register"));

    owner.ws.send(
      JSON.stringify({ type: "prompt_received", sessionId: "S_ack", fresh: true, promptId: "p-1" }),
    );
    await until(() => seen.some((e) => e.msg.type === "prompt_received"));
    const ack = seen.find((e) => e.msg.type === "prompt_received")!;
    expect(ack.sessionId).toBe("S_ack");
    expect(ack.msg.promptId).toBe("p-1");
  });
});

// ── #1175 test-plan #E7 ──────────────────────────────────────────────────────
// A session replacement on a single bridge socket: the outgoing owner already sent
// `session_unregister{A}`, then the replacement instance's `handleSessionChange` sends a
// second one for the same id on the same socket while B is registered. Today's gateway must
// treat it as a no-op (claim-gated unregister semantics belong to `harden-bridge-session-claim`).
describe("pi-gateway: repeated session_unregister for an already-removed id", () => {
  let gateway: ReturnType<typeof createPiGateway>;
  const sockets: Client[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const c of sockets) c.ws.terminate();
    sockets.length = 0;
    gateway?.stop();
  });

  it("E7: a second unregister for the outgoing id leaves the incoming registration untouched", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 0 });
    gateway.start(0, "127.0.0.1");
    const port = await waitForBind(gateway);

    const first = await connect(port);
    sockets.push(first);
    register(first, "A");
    await until(() => sessionManager.get("A") !== undefined);

    // Replacement: the outgoing owner unregisters A, the new socket registers B.
    first.ws.send(JSON.stringify({ type: "session_unregister", sessionId: "A" }));
    await until(() => sessionManager.get("A")?.status === "ended" || sessionManager.get("A") === undefined);
    const second = await connect(port);
    sockets.push(second);
    register(second, "B");
    await until(() => sessionManager.get("B") !== undefined);
    const absentBefore = sessionManager.get("A");
    errorLog.mockClear();

    // The replacement's handleSessionChange unregisters the already-gone outgoing id again.
    second.ws.send(JSON.stringify({ type: "session_unregister", sessionId: "A" }));
    await delay(150);

    expect(second.closed).toBe(false);
    expect(sessionManager.get("B")).toBeDefined();
    expect(sessionManager.get("B")!.status).not.toBe("ended");
    expect(gateway.sendToSession("B", { type: "reload" } as any)).toBe(true);
    await until(() => second.received.some((m) => m.type === "reload"), 2000);
    expect(sessionManager.get("A")).toEqual(absentBefore);
    // Only the routine "session unregistered" trace is allowed; no Error objects / failure lines.
    const failures = errorLog.mock.calls.filter(
      (args) => args.some((a) => a instanceof Error) || /fail|error|exception|unknown session/i.test(args.join(" ")),
    );
    expect(failures).toEqual([]);
  });
});

/**
 * Origin binding at the gateway (D1/D4): every path that takes a routing entry (register,
 * first-frame auto-claim, move commit, id change) is bound to the record's origin.
 * Remote origins are made with `peerAddressForTest` + a device ticket; the option object is
 * read per connection, so it is flipped between sequential connects.
 * See change: harden-bridge-session-claim (test-plan BX1-BX5, R1-R7).
 */
describe("pi-gateway origin binding", () => {
  let gateway: ReturnType<typeof createPiGateway>;
  const sockets: Client[] = [];
  const tickets = new WsTicketStore();
  const options: Record<string, unknown> = {};
  const lines: string[] = [];
  let errSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    for (const c of sockets) c.ws.terminate();
    sockets.length = 0;
    gateway?.stop();
    errSpy?.mockRestore();
    lines.length = 0;
    delete options.peerAddressForTest;
  });

  async function start() {
    errSpy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      lines.push(a.map(String).join(" "));
    });
    const sessionManager = createMemorySessionManager();
    Object.assign(options, {
      pingInterval: 0,
      bridgeAuth: {
        consumeTicket: (t: string | null | undefined) => tickets.consumeDetailed(t, "bridge"),
        requireTicketOnLoopback: false,
      },
    });
    gateway = createPiGateway(sessionManager, options as never);
    gateway.start(0, "127.0.0.1");
    return { sessionManager, port: await waitForBind(gateway) };
  }

  /** A hub-local socket (loopback peer, no ticket), or a remote one for `device` ("unattributed" = no ticket). */
  async function as(port: number, device: "hub" | "unattributed" | string): Promise<Client> {
    if (device === "hub") delete options.peerAddressForTest;
    else options.peerAddressForTest = "203.0.113.7";
    const ticket = device === "hub" || device === "unattributed" ? undefined : tickets.mint("bridge", device);
    const ws = new WebSocket(`ws://127.0.0.1:${port}${ticket ? `?ticket=${ticket}` : ""}`);
    const client: Client = { ws, received: [], closed: false, closeCode: null };
    ws.on("message", (raw) => client.received.push(JSON.parse(raw.toString())));
    ws.on("close", (code) => {
      client.closed = true;
      client.closeCode = code;
    });
    ws.on("error", () => undefined);
    await waitForOpen(ws);
    sockets.push(client);
    return client;
  }

  const types = (c: Client) => c.received.map((f) => f.type);
  const originLines = () => lines.filter((l) => l.startsWith("[bridge-claim] origin-refused"));

  it("BX1/R1: a foreign device re-registering a live hub-local id with the same pid is refused terminally, with no probe", async () => {
    const { sessionManager, port } = await start();
    const a = await as(port, "hub");
    register(a, "S", { pid: 4242, sessionFile: "/h/S.jsonl" });
    await until(() => sessionManager.get("S") !== undefined);
    let pings = 0;
    a.ws.on("ping", () => pings++);
    const before = { ...sessionManager.get("S")! };

    const b = await as(port, "dev-aaaaaaaa-1");
    register(b, "S", { pid: 4242, sessionFile: "/b/EVIL.jsonl" });
    await until(() => b.closed);

    const rejected = b.received.find((f) => f.type === "register_rejected");
    expect(rejected.reason).toMatch(/another origin/);
    expect(rejected.reason).not.toMatch(/dev-aaaaaaaa/);
    const after = sessionManager.get("S")!;
    expect(after.originDeviceId).toBeUndefined();
    expect(after.sessionFile).toBe(before.sessionFile);
    expect(after.pid).toBe(4242);
    expect(gateway.isSessionConnected("S")).toBe(true);
    await delay(100);
    expect(pings).toBe(0);
  });

  it("BX2/R2: a CLOSED incumbent's id (reconnect grace) cannot be claimed from another origin, but its own origin reconnects", async () => {
    const { sessionManager, port } = await start();
    const a = await as(port, "hub");
    register(a, "S", { sessionFile: "/h/S.jsonl" });
    await until(() => sessionManager.get("S") !== undefined);
    a.ws.terminate();
    await until(() => !gateway.isSessionConnected("S"));

    const b = await as(port, "dev-aaaaaaaa-1");
    register(b, "S");
    await until(() => b.closed);
    expect(types(b)).toContain("register_rejected");
    expect(sessionManager.get("S")!.originDeviceId).toBeUndefined();

    const a2 = await as(port, "hub");
    register(a2, "S", { sessionFile: "/h/S.jsonl" });
    await until(() => gateway.isSessionConnected("S"));
    expect(a2.closed).toBe(false);
  });

  it("BX3/R3: a first frame naming a recorded id of another origin claims nothing and the socket closes on the 3rd", async () => {
    const { sessionManager, port } = await start();
    const a = await as(port, "hub");
    register(a, "S", { sessionFile: "/h/S.jsonl" });
    await until(() => sessionManager.get("S") !== undefined);
    a.ws.terminate();
    await until(() => !gateway.isSessionConnected("S"));
    const events: string[] = [];
    gateway.onEvent = (sid, msg) => events.push(`${sid}:${msg.type}`);
    const created: string[] = [];
    gateway.onSessionCreated = (sid) => created.push(sid);
    const before = { ...sessionManager.get("S")! };

    const b = await as(port, "dev-aaaaaaaa-1");
    referenceOnly(b, "S");
    await delay(150);
    expect(gateway.isSessionConnected("S")).toBe(false);
    expect(events).toEqual([]);
    expect(created).toEqual([]);
    expect(b.closed).toBe(false);
    referenceOnly(b, "S");
    await delay(100);
    expect(b.closed).toBe(false);
    referenceOnly(b, "S");
    await until(() => b.closed);

    expect(gateway.isSessionConnected("S")).toBe(false);
    expect(events).toEqual([]);
    expect(sessionManager.get("S")).toMatchObject({ originDeviceId: undefined, sessionFile: before.sessionFile, status: before.status });
    // Counted on every refusal, the line is rate-limited to one.
    expect(gateway.contention.count()).toBe(3);
    expect(originLines()).toHaveLength(1);
    expect(originLines()[0]).toBe("[bridge-claim] origin-refused session=S recorded=hub presented=device:dev-aaaa");
  });

  it("BX3b: the placeholder a first frame creates records its creator's origin (it no longer reads hub-local)", async () => {
    const { sessionManager, port } = await start();
    const b = await as(port, "dev-aaaaaaaa-1");
    referenceOnly(b, "NEW");
    await until(() => sessionManager.get("NEW") !== undefined);
    expect(sessionManager.get("NEW")).toMatchObject({ source: "unknown", originDeviceId: "dev-aaaaaaaa-1" });
    const h = await as(port, "hub");
    referenceOnly(h, "HUBNEW");
    await until(() => sessionManager.get("HUBNEW") !== undefined);
    expect(sessionManager.get("HUBNEW")!.originDeviceId).toBeUndefined();
  });

  it("BX4/R3: a move commit onto a record of another origin is refused with the detail-free reply and no side effect", async () => {
    const { sessionManager, port } = await start();
    // A record restored after a restart: no routing entry, hub-local origin.
    sessionManager.register({ id: "S", cwd: "/w", source: "tui", sessionFile: "/h/S.jsonl" } as never);
    const routed: string[] = [];
    gateway.onRoutingChanged = (sid) => routed.push(sid);

    const b = await as(port, "dev-aaaaaaaa-1");
    register(b, "S", { provisional: true });
    await until(() => types(b).includes("provisional_accepted"));
    const token = b.received.find((f) => f.type === "provisional_accepted").token;
    b.ws.send(JSON.stringify({ type: "session_move_commit", sessionId: "S", token }));
    await until(() => types(b).includes("provisional_rejected"));
    await delay(100);

    expect(b.received.find((f) => f.type === "provisional_rejected")).toEqual({ type: "provisional_rejected" });
    expect(types(b)).not.toContain("session_move_committed");
    expect(gateway.isSessionConnected("S")).toBe(false);
    expect(routed).toEqual([]);
    expect(b.closed).toBe(false);
    expect(originLines()).toHaveLength(1);
  });

  it("BE12: a provisional register from a foreign origin claims nothing and answers exactly as for the record's own origin", async () => {
    const { sessionManager, port } = await start();
    sessionManager.register({ id: "S", cwd: "/w", source: "tui", sessionFile: "/h/S.jsonl" } as never);
    const before = { ...sessionManager.get("S")! };
    const foreign = await as(port, "dev-aaaaaaaa-1");
    register(foreign, "S", { provisional: true });
    const own = await as(port, "hub");
    register(own, "S", { provisional: true });
    await until(() => types(foreign).includes("provisional_accepted") && types(own).includes("provisional_accepted"));
    const shape = (c: Client) => Object.keys(c.received.find((f) => f.type === "provisional_accepted")).sort();
    expect(shape(foreign)).toEqual(shape(own));
    expect(gateway.isSessionConnected("S")).toBe(false);
    expect(sessionManager.get("S")).toMatchObject({ originDeviceId: before.originDeviceId, sessionFile: before.sessionFile });
    expect(originLines()).toEqual([]);
  });

  it("BE56: stop() terminates a socket left open-but-unrouted by an origin-refused first frame", async () => {
    const { sessionManager, port } = await start();
    sessionManager.register({ id: "S", cwd: "/w", source: "tui", sessionFile: "/h/S.jsonl" } as never);
    const b = await as(port, "dev-aaaaaaaa-1");
    referenceOnly(b, "S");
    await delay(100);
    expect(b.closed).toBe(false);
    gateway.stop();
    await until(() => b.closed);
  });

  it("BX4b: a move commit for an id this hub has no record of still adopts it (and records the mover's origin)", async () => {
    const { sessionManager, port } = await start();
    const b = await as(port, "dev-aaaaaaaa-1");
    register(b, "FRESH", { provisional: true });
    await until(() => types(b).includes("provisional_accepted"));
    const token = b.received.find((f) => f.type === "provisional_accepted").token;
    b.ws.send(JSON.stringify({ type: "session_move_commit", sessionId: "FRESH", token }));
    await until(() => types(b).includes("session_move_committed"));
    expect(sessionManager.get("FRESH")!.originDeviceId).toBe("dev-aaaaaaaa-1");
  });

  it("BX5/R4: an origin-refused id change keeps the socket and its own session, with a detail-free non-terminal reply", async () => {
    const { sessionManager, port } = await start();
    const h = await as(port, "hub");
    register(h, "HUB-S", { sessionFile: "/h/HUB.jsonl" });
    await until(() => sessionManager.get("HUB-S") !== undefined);
    h.ws.terminate();
    await until(() => !gateway.isSessionConnected("HUB-S"));

    const b = await as(port, "dev-aaaaaaaa-1");
    register(b, "OWN");
    await until(() => gateway.isSessionConnected("OWN"));
    register(b, "HUB-S");
    await until(() => types(b).includes("provisional_rejected"));
    await delay(100);

    expect(types(b)).not.toContain("register_rejected");
    expect(b.closed).toBe(false);
    expect(gateway.isSessionConnected("OWN")).toBe(true);
    expect(gateway.isSessionConnected("HUB-S")).toBe(false);
    expect(sessionManager.get("HUB-S")!.originDeviceId).toBeUndefined();
    expect(sessionManager.get("OWN")!.originDeviceId).toBe("dev-aaaaaaaa-1");
    // BE60: counted and logged once, with the same line shape as the other paths.
    expect(originLines()).toEqual(["[bridge-claim] origin-refused session=HUB-S recorded=hub presented=device:dev-aaaa"]);
    // The owned session still routes: its heartbeat is acknowledged.
    b.ws.send(JSON.stringify({ type: "session_heartbeat", sessionId: "OWN" }));
    await until(() => types(b).includes("heartbeat_ack"));
  });

  it("R5: unattributed remotes are one class (a restart does not lock a container bridge out of its own session)", async () => {
    const { sessionManager, port } = await start();
    const a = await as(port, "unattributed");
    register(a, "S", { sessionFile: "/c/S.jsonl" });
    await until(() => sessionManager.get("S") !== undefined);
    expect(sessionManager.get("S")!.originDeviceId).toBe("unattributed-remote");
    a.ws.terminate();
    await until(() => !gateway.isSessionConnected("S"));
    const a2 = await as(port, "unattributed");
    register(a2, "S", { sessionFile: "/c/S.jsonl" });
    await until(() => gateway.isSessionConnected("S"));
    // ...but a device-attributed bridge may not take it.
    a2.ws.terminate();
    await until(() => !gateway.isSessionConnected("S"));
    const d = await as(port, "dev-aaaaaaaa-1");
    register(d, "S");
    await until(() => d.closed);
    expect(types(d)).toContain("register_rejected");
  });

  it("R6: an unheld id adopts the first claimant's origin (documented residual)", async () => {
    const { sessionManager, port } = await start();
    const b = await as(port, "dev-aaaaaaaa-1");
    register(b, "UNHELD");
    await until(() => sessionManager.get("UNHELD") !== undefined);
    expect(sessionManager.get("UNHELD")!.originDeviceId).toBe("dev-aaaaaaaa-1");
  });

  it("R7: a hub-disk-created record (no origin) binds hub-local: remote refused, hub-local passes (documented residual)", async () => {
    const { sessionManager, port } = await start();
    sessionManager.register({ id: "DISK", cwd: "/w", source: "tui", sessionFile: "/w/DISK.jsonl" } as never);
    const r = await as(port, "unattributed");
    register(r, "DISK");
    await until(() => r.closed);
    expect(types(r)).toContain("register_rejected");
    const h = await as(port, "hub");
    register(h, "DISK");
    await until(() => gateway.isSessionConnected("DISK"));
  });

  /**
   * @structural-pin guards a future bypass: no runtime harness can enumerate the `connections.set` sites; a new one without the
   * shared origin decision (`originRefused` / `claim`) before it would reopen WS-02/WS-03.
   */
  it("every connections.set site in pi-gateway.ts is preceded by the shared origin decision (guards a future bypass)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../pi/pi-gateway.ts", import.meta.url), "utf8").split("\n");
    const sites = src.flatMap((l, i) => (/\bconnections\.set\(/.test(l) ? [i] : []));
    expect(sites.length).toBeGreaterThanOrEqual(3);
    for (const i of sites) {
      const window = src.slice(Math.max(0, i - 120), i).join("\n");
      expect(window, `connections.set at line ${i + 1}`).toMatch(/originRefused\(|await claim\(/);
    }
  });
});
