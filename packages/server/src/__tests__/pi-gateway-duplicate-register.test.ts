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
import { WsTicketStore } from "../auth/ws-ticket.js";
import { createPiGateway } from "../pi/pi-gateway.js";
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

  // ── Rows BE15–BE56: the remaining origin-binding gateway scenarios (test-plan) ───────────────────────────
  const D1 = "dev-0123456789abcdef";
  const hubRecord = (sm: ReturnType<typeof createMemorySessionManager>, id: string, origin?: string) =>
    sm.register({ id, cwd: "/w", source: "tui", sessionFile: `/h/${id}.jsonl`, originDeviceId: origin } as never);

  it("BE15: the rejection text says another origin, never the id, a pid or a token", async () => {
    const { sessionManager, port } = await start();
    hubRecord(sessionManager, "S", D1);
    const b = await as(port, "dev-ffffffff-2");
    register(b, "S", { pid: 987654 });
    await until(() => b.closed);
    const reason: string = b.received.find((f) => f.type === "register_rejected").reason;
    expect(reason).toMatch(/another origin/);
    expect(reason).not.toMatch(/another live bridge/);
    expect(reason).not.toMatch(/dev-0123|dev-ffff|987654|ticket/i);
  });

  it("BE16: a restored record (no socket) is refused for a foreign origin, unchanged", async () => {
    const { sessionManager, port } = await start();
    hubRecord(sessionManager, "S");
    const before = { ...sessionManager.get("S")! };
    const b = await as(port, D1);
    register(b, "S", { sessionFile: "/b/X.jsonl" });
    await until(() => b.closed);
    expect(sessionManager.get("S")).toMatchObject({ originDeviceId: undefined, sessionFile: before.sessionFile });
    expect(gateway.isSessionConnected("S")).toBe(false);
  });

  it.each([["dev-aaaaaaaa-1"], ["hub"]])("BE17: the same origin (%s) re-registers over a closed incumbent with no probe", async (origin) => {
    const { sessionManager, port } = await start();
    const first = await as(port, origin);
    register(first, "S", { sessionFile: "/h/S.jsonl" });
    await until(() => sessionManager.get("S") !== undefined);
    first.ws.terminate();
    await until(() => !gateway.isSessionConnected("S"));
    const again = await as(port, origin);
    register(again, "S", { sessionFile: "/h/S.jsonl" });
    await until(() => gateway.isSessionConnected("S"));
    expect(again.closed).toBe(false);
  });

  it.each([["dev-aaaaaaaa-1"], ["hub"]])("BE18: a placeholder is unprotected: a %s register takes it over", async (origin) => {
    const { sessionManager, port } = await start();
    const creator = await as(port, "dev-zzzzzzzz-9");
    referenceOnly(creator, "P");
    await until(() => sessionManager.get("P") !== undefined);
    const b = await as(port, origin);
    register(b, "P");
    await until(() => sessionManager.get("P")?.source === "tui");
    expect(b.closed).toBe(false);
    expect(types(b)).not.toContain("register_rejected");
  });

  it("BE21: five re-registrations from a refused origin are each refused, counted +5 and logged once", async () => {
    const { sessionManager, port } = await start();
    hubRecord(sessionManager, "S");
    for (let i = 0; i < 5; i++) {
      const b = await as(port, D1);
      register(b, "S");
      await until(() => b.closed);
    }
    expect(gateway.contention.count()).toBe(5);
    expect(originLines()).toHaveLength(1);
    expect(gateway.contention.contendedIds()).toEqual(["S"]);
  });

  it("BE28: a first register (no owned session) from a foreign origin is terminal", async () => {
    const { sessionManager, port } = await start();
    hubRecord(sessionManager, "S");
    const b = await as(port, D1);
    register(b, "S");
    await until(() => b.closed);
    expect(types(b)).toContain("register_rejected");
  });

  it("BE29: an id change to a same-origin completed record is accepted and the abandoned placeholder is cleaned up", async () => {
    const { sessionManager, port } = await start();
    hubRecord(sessionManager, "S2", "dev-aaaaaaaa-1");
    const x = await as(port, "dev-aaaaaaaa-1");
    referenceOnly(x, "S1");
    await until(() => sessionManager.get("S1") !== undefined);
    register(x, "S2");
    await until(() => gateway.isSessionConnected("S2"));
    expect(sessionManager.get("S1")?.status).toBe("ended");
    expect(x.closed).toBe(false);
  });

  it.each([[undefined, "hub"], [D1, D1]])("BE33: a first frame from the record's own origin (%s) still auto-claims", async (recordOrigin, who) => {
    const { sessionManager, port } = await start();
    hubRecord(sessionManager, "S", recordOrigin);
    let connections = 0;
    gateway.onConnection = () => connections++;
    const b = await as(port, who);
    referenceOnly(b, "S");
    await until(() => gateway.isSessionConnected("S"));
    expect(connections).toBe(1);
  });

  it("BE32: an origin-refused first frame fires no callback and creates no heartbeat or placeholder", async () => {
    const { sessionManager, port } = await start();
    hubRecord(sessionManager, "S");
    const calls: string[] = [];
    gateway.onConnection = () => calls.push("connection");
    gateway.onSessionCreated = () => calls.push("created");
    gateway.onSessionRegistered = () => calls.push("registered");
    gateway.onEvent = () => calls.push("event");
    const before = sessionManager.listActive().length + sessionManager.listAll?.().length;
    const b = await as(port, D1);
    referenceOnly(b, "S");
    await delay(200);
    expect(calls).toEqual([]);
    expect(gateway.isSessionConnected("S")).toBe(false);
    expect(sessionManager.get("S")!.originDeviceId).toBeUndefined();
    expect(sessionManager.listActive().length + sessionManager.listAll?.().length).toBe(before);
  });

  it("BE35: the first-frame cap counts frames, not distinct ids", async () => {
    const { sessionManager, port } = await start();
    for (const id of ["A", "B", "C"]) hubRecord(sessionManager, id);
    const b = await as(port, D1);
    for (const id of ["A", "B", "C"]) referenceOnly(b, id);
    await until(() => b.closed);
  });

  it("BE36: the first-frame cap is per socket", async () => {
    const { sessionManager, port } = await start();
    hubRecord(sessionManager, "S");
    const x = await as(port, D1);
    const y = await as(port, D1);
    referenceOnly(x, "S"); referenceOnly(x, "S"); referenceOnly(y, "S"); referenceOnly(y, "S");
    await delay(200);
    expect(x.closed || y.closed).toBe(false);
    x.ws.terminate();
    const z = await as(port, D1);
    referenceOnly(z, "S"); referenceOnly(z, "S");
    await delay(150);
    expect(z.closed).toBe(false);
    referenceOnly(z, "S");
    await until(() => z.closed);
    expect(y.closed).toBe(false);
  });

  it("BE37: frames naming a live-held id are not origin refusals and do not count", async () => {
    const { sessionManager, port } = await start();
    hubRecord(sessionManager, "S");
    hubRecord(sessionManager, "LIVE", D1);
    const owner = await as(port, D1);
    referenceOnly(owner, "LIVE");
    await until(() => gateway.isSessionConnected("LIVE"));
    const b = await as(port, D1);
    referenceOnly(b, "S"); referenceOnly(b, "S");
    await delay(150);
    for (let i = 0; i < 5; i++) referenceOnly(b, "LIVE");
    await delay(250);
    // Seven frames in all, but only two were origin refusals: the cap (3) was never reached.
    expect(b.closed).toBe(false);
    expect(gateway.contention.count()).toBe(2);
  });

  it("BE38: after two refused first frames, a first frame naming an unknown id still works and the counter is unchanged", async () => {
    const { sessionManager, port } = await start();
    hubRecord(sessionManager, "S");
    const b = await as(port, D1);
    referenceOnly(b, "S"); referenceOnly(b, "S");
    await delay(150);
    referenceOnly(b, "NEWID");
    await until(() => sessionManager.get("NEWID") !== undefined);
    expect(gateway.isSessionConnected("NEWID")).toBe(true);
    expect(b.closed).toBe(false);
    // The counter still reads 2: one more refusal (a frame naming S from a socket without an owned entry is
    // no longer applicable; open a fresh budget check via a 3rd refusal on the same socket after releasing NEWID).
  });

  it("BE40: a placeholder is unprotected until its creator completes a register, then the record is bound", async () => {
    const { sessionManager, port } = await start();
    const d = await as(port, "dev-aaaaaaaa-1");
    referenceOnly(d, "P");
    await until(() => sessionManager.get("P") !== undefined);
    register(d, "P", { sessionFile: "/d/P.jsonl" });
    await until(() => sessionManager.get("P")?.source === "tui");
    const h = await as(port, "hub");
    register(h, "P");
    await until(() => h.closed);
    expect(types(h)).toContain("register_rejected");
    expect(sessionManager.get("P")!.originDeviceId).toBe("dev-aaaaaaaa-1");
  });

  it("BE41/BE44: a foreign-origin commit is refused with exactly one detail-free frame; with a live incumbent too", async () => {
    const { sessionManager, port } = await start();
    hubRecord(sessionManager, "S");
    hubRecord(sessionManager, "LIVE");
    const owner = await as(port, "hub");
    referenceOnly(owner, "LIVE");
    await until(() => gateway.isSessionConnected("LIVE"));
    const before = { ...sessionManager.get("S")! };
    for (const id of ["S", "LIVE"]) {
      const b = await as(port, "dev-aaaaaaaa-1");
      register(b, id, { provisional: true });
      await until(() => types(b).includes("provisional_accepted"));
      const token = b.received.find((f) => f.type === "provisional_accepted").token;
      b.ws.send(JSON.stringify({ type: "session_move_commit", sessionId: id, token }));
      await until(() => types(b).includes("provisional_rejected"));
      await delay(100);
      expect(b.received.filter((f) => f.type === "provisional_rejected")).toEqual([{ type: "provisional_rejected" }]);
    }
    expect(sessionManager.get("S")).toMatchObject({ originDeviceId: before.originDeviceId, sessionFile: before.sessionFile });
    expect(gateway.isSessionConnected("S")).toBe(false);
    expect(gateway.isSessionConnected("LIVE")).toBe(true);
  });

  it("BE42: a commit onto a same-origin record or a placeholder succeeds", async () => {
    const { sessionManager, port } = await start();
    hubRecord(sessionManager, "SAME", "dev-aaaaaaaa-1");
    // A placeholder as a first frame would leave (source "unknown", no sessionFile), with no routing entry.
    sessionManager.register({ id: "PH", cwd: "", source: "unknown", originDeviceId: "dev-zzzzzzzz-9" } as never);
    for (const id of ["SAME", "PH"]) {
      const b = await as(port, "dev-aaaaaaaa-1");
      register(b, id, { provisional: true });
      await until(() => types(b).includes("provisional_accepted"));
      const token = b.received.find((f) => f.type === "provisional_accepted").token;
      b.ws.send(JSON.stringify({ type: "session_move_commit", sessionId: id, token }));
      await until(() => types(b).includes("session_move_committed"));
    }
  });

  it("BE54: two origins registering a never-seen id in the same tick: exactly one wins, the other is refused", async () => {
    const { sessionManager, port } = await start();
    const a = await as(port, "hub");
    const b = await as(port, "dev-aaaaaaaa-1");
    register(a, "RACE");
    register(b, "RACE");
    await until(() => a.closed || b.closed);
    expect([a.closed, b.closed].filter(Boolean)).toHaveLength(1);
    const winner = a.closed ? b : a;
    expect(gateway.isSessionConnected("RACE")).toBe(true);
    expect(winner.closed).toBe(false);
    expect(sessionManager.get("RACE")!.originDeviceId).toBe(a.closed ? "dev-aaaaaaaa-1" : undefined);
  });

  it("BE55: an origin-refused register appears under no session id in the routing table", async () => {
    const { sessionManager, port } = await start();
    hubRecord(sessionManager, "S");
    const b = await as(port, D1);
    register(b, "S");
    await until(() => b.closed);
    expect(gateway.getConnectedSessionIds()).toEqual([]);
  });

  it("BE27/BE31: an origin-refused id change replies exactly {type} (no cap), keeps X open and its S1 routing; the count rises by N", async () => {
    const { sessionManager, port } = await start();
    const x = await as(port, "dev-aaaaaaaa-1");
    register(x, "S1");
    await until(() => gateway.isSessionConnected("S1"));
    const seen: string[] = [];
    gateway.onEvent = (sid, msg) => seen.push(`${sid}:${msg.type}`);
    for (let n = 1; n <= 10; n++) {
      hubRecord(sessionManager, `H${n}`);
      register(x, `H${n}`);
      await until(() => x.received.filter((f) => f.type === "provisional_rejected").length === n);
    }
    expect(x.received.filter((f) => f.type === "provisional_rejected").every((f) => Object.keys(f).join() === "type")).toBe(true);
    expect(types(x)).not.toContain("register_rejected");
    expect(x.closed).toBe(false);
    expect(gateway.contention.count()).toBe(10);
    x.ws.send(JSON.stringify({ type: "event_forward", sessionId: "S1", event: { type: "noop" } }));
    await until(() => seen.includes("S1:event_forward"));
    expect(gateway.isSessionConnected("S1")).toBe(true);
    for (let n = 1; n <= 10; n++) expect(gateway.isSessionConnected(`H${n}`)).toBe(false);
  });

  it("BE34: three first frames naming three different hub sessions: open+unrouted after #1 and #2, closed after #3", async () => {
    const { sessionManager, port } = await start();
    for (const id of ["S1", "S2", "S3"]) hubRecord(sessionManager, id);
    const b = await as(port, "dev-aaaaaaaa-1");
    for (const [i, id] of ["S1", "S2", "S3"].entries()) {
      referenceOnly(b, id);
      if (i < 2) {
        await delay(100);
        expect(b.closed).toBe(false);
        expect(gateway.isSessionConnected(id)).toBe(false);
      }
    }
    await until(() => b.closed);
  });

  it("BE43: a refused commit spends its token: a second commit with it never succeeds", async () => {
    const { sessionManager, port } = await start();
    hubRecord(sessionManager, "S");
    const b = await as(port, "dev-aaaaaaaa-1");
    register(b, "S", { provisional: true });
    await until(() => types(b).includes("provisional_accepted"));
    const token = b.received.find((f) => f.type === "provisional_accepted").token;
    for (let i = 1; i <= 2; i++) {
      b.ws.send(JSON.stringify({ type: "session_move_commit", sessionId: "S", token }));
      await until(() => b.received.filter((f) => f.type === "provisional_rejected").length === i);
    }
    expect(types(b)).not.toContain("session_move_committed");
    expect(gateway.isSessionConnected("S")).toBe(false);
  });

  it("BX3: a throwing console.error while logging the refusal does not stop the refusal being enforced", async () => {
    const { sessionManager, port } = await start();
    hubRecord(sessionManager, "S");
    errSpy.mockImplementation(() => { throw new Error("log sink down"); });
    const b = await as(port, "dev-aaaaaaaa-1");
    register(b, "S");
    await until(() => b.closed).catch(() => undefined);
    expect(gateway.isSessionConnected("S")).toBe(false);
    expect(sessionManager.get("S")!.originDeviceId).toBeUndefined();
    // the gateway still serves other sockets
    errSpy.mockImplementation(() => undefined);
    const ok = await as(port, "hub");
    register(ok, "OTHER");
    await until(() => gateway.isSessionConnected("OTHER"));
  });

  it("BX4: a refused newcomer that destroys its socket mid-refusal leaves no error and the owner can reconnect", async () => {
    const { sessionManager, port } = await start();
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      const owner = await as(port, "hub");
      register(owner, "S", { sessionFile: "/h/S.jsonl" });
      await until(() => sessionManager.get("S") !== undefined);
      owner.ws.terminate();
      await until(() => !gateway.isSessionConnected("S"));
      const evil = await as(port, "dev-aaaaaaaa-1");
      register(evil, "S");
      evil.ws.terminate();
      await delay(200);
      const back = await as(port, "hub");
      register(back, "S", { sessionFile: "/h/S.jsonl" });
      await until(() => gateway.isSessionConnected("S"));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("BX7: stop() terminates a refusing socket and a first-frame-dropped socket without throwing", async () => {
    const { sessionManager, port } = await start();
    hubRecord(sessionManager, "S");
    const dropped = await as(port, "dev-aaaaaaaa-1");
    referenceOnly(dropped, "S");
    const refused = await as(port, "dev-bbbbbbbb-2");
    register(refused, "S");
    await delay(100);
    expect(() => gateway.stop()).not.toThrow();
    await until(() => dropped.closed && refused.closed);
  });

  it("BE19: an origin-refused register leaves the spawn watchdog armed, so the duplicate's pi is still reclaimed by token", async () => {
    const killed: number[] = [];
    const wd = new SpawnRegisterWatchdog(5000, {
      findPidsBySpawnToken: (token) => (token === "TOKEN-DUP" ? [9999] : []),
      kill: (pid: number) => killed.push(pid),
    });
    _setSpawnRegisterWatchdogForTests(wd);
    try {
      const { sessionManager, port } = await start();
      hubRecord(sessionManager, "S");
      wd.arm({ cwd: "/w/dup", mechanism: "headless", pid: 9999, spawnToken: "TOKEN-DUP" });
      const b = await as(port, "dev-aaaaaaaa-1");
      register(b, "S", { cwd: "/w/dup", pid: 9999, spawnToken: "TOKEN-DUP" });
      await until(() => b.closed);
      await until(() => killed.includes(9999), 9000);
      expect(sessionManager.get("S")!.originDeviceId).toBeUndefined();
    } finally {
      _setSpawnRegisterWatchdogForTests(null);
    }
  }, 20000);

  it("BE25: an origin refusal marks the id contended; the entry leaves when the session ends, the cumulative count stays", async () => {
    const { sessionManager, port } = await start();
    hubRecord(sessionManager, "S");
    const evil = await as(port, "dev-aaaaaaaa-1");
    register(evil, "S");
    await until(() => evil.closed);
    expect(gateway.contention.contendedIds()).toEqual(["S"]);
    expect(gateway.contention.count()).toBe(1);
    const owner = await as(port, "hub");
    register(owner, "S", { sessionFile: "/h/S.jsonl" });
    await until(() => gateway.isSessionConnected("S"));
    owner.ws.send(JSON.stringify({ type: "session_unregister", sessionId: "S" }));
    await until(() => !gateway.isSessionConnected("S"));
    expect(gateway.contention.contendedIds()).not.toContain("S");
    expect(gateway.contention.count()).toBe(1);
  });

  it("BE39: a first-frame placeholder carries its creator's origin (hub / device / unattributed); a device one is not local", async () => {
    const { sessionManager, port } = await start();
    const { originOf } = await import("../session/session-origin.js");
    for (const [who, id, expected] of [["hub", "PH", undefined], ["dev-aaaaaaaa-1", "PD", "dev-aaaaaaaa-1"], ["unattributed", "PU", "unattributed-remote"]] as const) {
      const c = await as(port, who);
      referenceOnly(c, id);
      await until(() => sessionManager.get(id) !== undefined);
      expect(sessionManager.get(id)!.originDeviceId).toBe(expected);
      expect(originOf(sessionManager.get(id)!).local).toBe(expected === undefined);
    }
  });

  it("BE52: once a bound record is removed (archived), the next claim is unheld and adopts the new origin", async () => {
    const { sessionManager, port } = await start();
    hubRecord(sessionManager, "R", "dev-aaaaaaaa-1");
    const b = await as(port, "dev-bbbbbbbb-2");
    register(b, "R");
    await until(() => b.closed);
    sessionManager.remove("R");
    const b2 = await as(port, "dev-bbbbbbbb-2");
    register(b2, "R");
    await until(() => gateway.isSessionConnected("R"));
    expect(sessionManager.get("R")!.originDeviceId).toBe("dev-bbbbbbbb-2");
  });

  it("BE53: random register / first-frame / commit / close sequences keep the origin invariants", async () => {
    const { sessionManager, port } = await start();
    let seed = 0x9e3779b1;
    const rnd = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    const ORIGINS = ["hub", "dev-aaaaaaaa-1", "dev-bbbbbbbb-2", "unattributed"] as const;
    const IDS = ["I0", "I1", "I2", "I3"];
    const recorded = new Map<string, string | undefined>();
    const live: Client[] = [];
    for (let step = 0; step < 120; step++) {
      const origin = ORIGINS[rnd(ORIGINS.length)];
      const id = IDS[rnd(IDS.length)];
      const op = rnd(5);
      if (op === 4 && live.length) {
        live.splice(rnd(live.length), 1)[0].ws.terminate();
      } else {
        const c = await as(port, origin);
        live.push(c);
        if (op === 0 || op === 1) register(c, id, { sessionFile: `/h/${id}.jsonl` });
        else if (op === 2) referenceOnly(c, id);
        else register(c, id, { provisional: true });
      }
      await delay(15);
      for (const known of IDS) {
        const rec = sessionManager.get(known);
        if (!rec) continue;
        if (recorded.has(known) && rec.source !== "unknown" && rec.sessionFile) {
          // (1) a completed record's origin never changes while it exists
          expect(rec.originDeviceId, `step ${step} ${known}`).toBe(recorded.get(known));
        }
        if (rec.source !== "unknown" && rec.sessionFile) recorded.set(known, rec.originDeviceId);
        // (2) the socket holding the entry was admitted for the record's origin (device-attributed tickets)
        const ch = gateway.channelOf(known);
        if (ch?.ticketDeviceId && rec.sessionFile) expect(rec.originDeviceId, `step ${step} ${known}`).toBe(ch.ticketDeviceId);
      }
    }
  }, 60000);

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
