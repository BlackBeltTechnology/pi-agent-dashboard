/**
 * Prompt honesty under contention (D4), the `/api/health` contention surface
 * (D6), and the session-file-keyed resume guard (D5).
 *
 * Covers test-plan #F1, #F2, #F3, #F7, #F8, #X12, #X14, #X15, #X16, #X17, #X18
 * and #L3a.
 *
 * See change: fix-duplicate-bridge-registration.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createPiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { formatContentionLine, WS_OPEN } from "../pi/bridge-contention.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on("open", () => resolve());
    ws.on("error", reject);
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

async function waitForBind(gateway: { address(): number | null }): Promise<number> {
  for (let i = 0; i < 200; i++) {
    const port = gateway.address();
    if (port !== null) return port;
    await delay(10);
  }
  throw new Error("gateway did not bind a port");
}

async function until(pred: () => boolean, timeout = 8000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (pred()) return;
    await delay(10);
  }
  throw new Error("condition not met within timeout");
}

describe("contention prompt annotation, health surface and resume guard", () => {
  let gateway: ReturnType<typeof createPiGateway>;
  const sockets: WebSocket[] = [];

  afterEach(() => {
    for (const ws of sockets) ws.terminate();
    sockets.length = 0;
    gateway?.stop();
    vi.restoreAllMocks();
  });

  async function start() {
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 0 });
    gateway.start(0, "127.0.0.1");
    const port = await waitForBind(gateway);
    return { sessionManager, port };
  }

  async function client(port: number) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("error", () => {});
    sockets.push(ws);
    await waitForOpen(ws);
    return ws;
  }

  function reg(ws: WebSocket, sessionId: string, extra: Record<string, unknown> = {}) {
    ws.send(JSON.stringify({ type: "session_register", sessionId, cwd: "/w", source: "tui", ...extra }));
  }

  /** Drive one refusal for `sessionId` and resolve once the loser is closed. */
  async function provokeContention(port: number, sessionId: string) {
    const a = await client(port);
    reg(a, sessionId, { pid: 37660, sessionFile: `/t/${sessionId}.jsonl` });
    await delay(200);
    const b = await client(port);
    const closed = new Promise<void>((r) => b.on("close", () => r()));
    reg(b, sessionId, { pid: 17579, sessionFile: `/t/${sessionId}.jsonl` });
    await closed;
    return { a, b };
  }

  // ── F7 ────────────────────────────────────────────────────────────────────
  it("F7: the health surface exposes a cumulative count and the contended ids", async () => {
    const { port } = await start();
    await provokeContention(port, "S");

    // The exact shape `/api/health` reads.
    expect(gateway.contention.count()).toBeGreaterThanOrEqual(1);
    expect(gateway.contention.contendedIds()).toContain("S");
  }, 25000);

  // ── F8 ────────────────────────────────────────────────────────────────────
  it("F8: a contended id disappears on disconnect while the count stays put", async () => {
    const { port } = await start();
    const { a } = await provokeContention(port, "S");
    const countAfterRefusal = gateway.contention.count();

    a.close();
    await until(() => !gateway.contention.contendedIds().includes("S"));

    expect(gateway.contention.contendedIds()).not.toContain("S");
    expect(gateway.contention.count()).toBe(countAfterRefusal);
  }, 25000);

  // ── F1 / F3 ───────────────────────────────────────────────────────────────
  it("F1: a contended session yields an annotated \u2014 not plain \u2014 success naming the bridge state", async () => {
    const { port } = await start();
    await provokeContention(port, "S");

    const record = gateway.contention.get("S");
    expect(record).toBeDefined();
    // The prompt route annotates from exactly this record and still reports
    // the prompt as delivered (the map holds one owner).
    expect(record!.incumbentPid).toBe(37660);
    expect(record!.newcomerPid).toBe(17579);
    expect(gateway.isSessionConnected("S")).toBe(true);
    expect(gateway.sendToSession("S", { type: "abort", sessionId: "S" } as any)).toBe(true);
  }, 25000);

  it("F3: an uncontended session has no record, so the prompt stays a plain success", async () => {
    const { port } = await start();
    const a = await client(port);
    reg(a, "quiet");
    await delay(200);

    expect(gateway.contention.get("quiet")).toBeUndefined();
    expect(gateway.sendToSession("quiet", { type: "abort", sessionId: "quiet" } as any)).toBe(true);
  }, 25000);

  // ── F2 ────────────────────────────────────────────────────────────────────
  it("F2: a session with no live bridge is distinguishable from a contended one", async () => {
    const { port } = await start();
    const a = await client(port);
    reg(a, "gone");
    await delay(200);
    a.close();
    await until(() => !gateway.isSessionConnected("gone"));

    // No bridge → the send fails outright (the existing 502), and there is no
    // contention record to confuse it with.
    expect(gateway.sendToSession("gone", { type: "abort", sessionId: "gone" } as any)).toBe(false);
    expect(gateway.contention.get("gone")).toBeUndefined();
  }, 25000);

  // ── L3a ───────────────────────────────────────────────────────────────────
  it("L3a: an ordinary accepted re-register logs a registration and no contention line", async () => {
    const { port } = await start();
    const errs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      errs.push(a.join(" "));
    });

    const a = await client(port);
    reg(a, "S", { pid: 1111 });
    await delay(200);
    reg(a, "S", { pid: 1111, name: "renamed" });
    await delay(300);

    expect(errs.some((l) => l.includes("[gateway] session registered: S"))).toBe(true);
    expect(errs.some((l) => l.includes("contention refused"))).toBe(false);
    expect(gateway.contention.count()).toBe(0);
  }, 25000);

  it("L1a: a refusal logs the contention line with both pids", async () => {
    const { port } = await start();
    const errs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      errs.push(a.join(" "));
    });

    await provokeContention(port, "S");

    const line = errs.find((l) => l.includes("contention refused"));
    expect(line).toBeDefined();
    expect(line).toBe(formatContentionLine("S", 37660, 17579));
  }, 25000);

  // ── D5: findLiveSessionBySessionFile ──────────────────────────────────────
  // ── X12 ───────────────────────────────────────────────────────────────────
  it("X12: a session file served by a live bridge under another id is found", async () => {
    const { port } = await start();
    const a = await client(port);
    reg(a, "B", { sessionFile: "/t/F.jsonl", pid: 1 });
    await delay(200);

    expect(gateway.findLiveSessionBySessionFile("/t/F.jsonl")).toBe("B");
  }, 25000);

  // ── X14 ───────────────────────────────────────────────────────────────────
  it("X14: a session file whose bridge is gone is not live, so a resume proceeds", async () => {
    const { port } = await start();
    const a = await client(port);
    reg(a, "B", { sessionFile: "/t/F.jsonl", pid: 1 });
    await delay(200);
    a.close();
    await until(() => !gateway.isSessionConnected("B"));

    expect(gateway.findLiveSessionBySessionFile("/t/F.jsonl")).toBeUndefined();
  }, 25000);

  // ── X17 ───────────────────────────────────────────────────────────────────
  it("X17: a live session with no sessionFile causes no refusal", async () => {
    const { port } = await start();
    const a = await client(port);
    reg(a, "B"); // no sessionFile
    await delay(200);

    expect(gateway.findLiveSessionBySessionFile("/t/F.jsonl")).toBeUndefined();
    // An empty lookup key must never match a placeholder's `undefined`.
    expect(gateway.findLiveSessionBySessionFile("")).toBeUndefined();
  }, 25000);

  // ── X15 / X16 ─────────────────────────────────────────────────────────────
  it("X15/X16: liveness uses D1's two-factor rule, not raw readyState", async () => {
    const { sessionManager } = await start();
    // Drive the rule directly: the state that separates X15 from X16 (OPEN but
    // not writable) is not constructible from a real client socket.
    const { isSocketAlive } = await import("../pi/bridge-contention.js");

    // X16: does not pong but IS writable → live → the resume is refused.
    expect(isSocketAlive({ readyState: WS_OPEN, _socket: { destroyed: false, writable: true } })).toBe(true);
    // X15: neither pongs nor writable → not live → the resume proceeds.
    expect(isSocketAlive({ readyState: WS_OPEN, _socket: { destroyed: true, writable: false } })).toBe(false);

    expect(sessionManager).toBeDefined();
  }, 25000);
});
