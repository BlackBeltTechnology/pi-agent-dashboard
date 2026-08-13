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

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createPiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";

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
export async function waitForBind(gateway: { address(): number | null }): Promise<number> {
  for (let i = 0; i < 200; i++) {
    const port = gateway.address();
    if (port !== null) return port;
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
  it("E17: a non-owning socket closing neither unregisters nor finalizes an automation session", async () => {
    const { sessionManager, port } = await startGateway();

    const a = await newClient(port);
    register(a, "S");
    await delay(100);
    sessionManager.update("S", { kind: "automation" } as any);

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
  it("E18: the owning socket closing finalizes an automation session as today", async () => {
    const { sessionManager, port } = await startGateway();

    const a = await newClient(port);
    register(a, "S");
    await delay(100);
    sessionManager.update("S", { kind: "automation" } as any);

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
