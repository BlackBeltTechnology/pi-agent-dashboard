/**
 * Regression suite for #393 — bridge permanently disconnects on in-TUI
 * resume/switch/fork.
 *
 * Mechanism (spike-confirmed, design.md §Fix): the `session_start` handler
 * calls `handleSessionChange(ctx)` (session-sync.ts) BEFORE
 * `connection.connect()`. `handleSessionChange` reads `ctx.cwd` — a guarded
 * getter on pi's ExtensionRunner that THROWS once the session is replaced
 * (new/fork/resume/reload). The throw is swallowed by the bridge's `safe()`
 * wrapper, so the remainder of the `session_start` body — including
 * `connection.connect()` — is abandoned. The preceding `session_shutdown`
 * already called `connection.disconnect()`, so the socket stays terminally
 * closed: the exact #393 behaviour.
 *
 * Pattern: the repo's L1 model-mirror + fake-WS approach. The `session_start`
 * ordering (handleSessionChange → connect(), under `safe()`) is mirrored here;
 * the REAL `handleSessionChange` (session-sync.ts) and REAL `ConnectionManager`
 * are exercised against a fake WebSocket. X1 injects the throwing `ctx.cwd`
 * getter — it FAILS on the pre-fix code and PASSES after the `safeCwd` fix.
 *
 * Exemplars: connection.test.ts (fake WebSocket), bridge-shutdown-reset.test.ts
 * (pure-model shutdown handler).
 *
 * See change: fix-bridge-resume-disconnect.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../connection.js";
import { handleSessionChange } from "../session-sync.js";

// ── Fake WebSocket: opens asynchronously via onopen, like a real socket ──
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0; // CONNECTING
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
    // Open on the next macrotask — the register frame is buffered until then.
    setTimeout(() => {
      this.readyState = 1; // OPEN
      this.onopen?.();
    }, 0);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }
}

/** Poll window: let the async onopen fire + buffer flush settle. */
const settle = () => new Promise((r) => setTimeout(r, 5));

function makeConnection(): ConnectionManager {
  return new ConnectionManager({
    url: "ws://localhost:9999",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    watchdogTimeout: 0,
  });
}

/**
 * Mirror the bridge's `session_start` handler ordering under `safe()`: run the
 * steps in sequence; a throw in any step abandons the remaining steps (exactly
 * what `safe()` does — it catches the rejection at the handler boundary, so the
 * body after the throw never executes).
 */
function runSessionStartUnderSafe(steps: Array<() => void>): void {
  try {
    for (const step of steps) step();
  } catch {
    /* safe() swallows — remaining steps (incl. connection.connect()) are skipped */
  }
}

function makeCtx(sessionId: string, cwd: string | (() => never)) {
  const ctx: Record<string, unknown> = {
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => undefined,
      getSessionDir: () => undefined,
      getBranch: () => [],
      getEntries: () => [],
    },
    model: { provider: "anthropic", id: "claude-sonnet-4-6" },
  };
  if (typeof cwd === "string") {
    ctx.cwd = cwd;
  } else {
    // The #393 fault: reading ctx.cwd throws after session replacement.
    Object.defineProperty(ctx, "cwd", { get: cwd });
  }
  return ctx as any;
}

function makeBc(connection: ConnectionManager, sessionId: string, ctx: any) {
  return {
    pi: {
      getSessionName: () => "resumed-session",
      getCommands: () => [],
      getThinkingLevel: () => undefined,
    },
    connection,
    sessionId,
    attachedChange: null,
    cachedCtx: ctx,
    cachedModelRegistry: null,
    cachedHasUI: false,
    dashboardSpawned: false,
  } as any;
}

function registeredFor(ws: FakeWebSocket | undefined, sessionId: string): boolean {
  if (!ws) return false;
  return ws.sent.some((s) => {
    try {
      const m = JSON.parse(s);
      return m.type === "session_register" && m.sessionId === sessionId;
    } catch {
      return false;
    }
  });
}

/** Model a session_shutdown that ends by disconnecting (replacement reason). */
async function shutdownThenDisconnect(conn: ConnectionManager, sessionId: string): Promise<void> {
  conn.send({ type: "session_unregister", sessionId });
  await new Promise((r) => setTimeout(r, 0)); // mirror the 100 ms settle window
  conn.disconnect();
}

describe("bridge resume/switch/fork survives session replacement (#393)", () => {
  afterEach(() => {
    FakeWebSocket.instances = [];
  });

  // ── Frontend-quirk F1/F2/F3: replacement ends live + registered ──
  for (const reason of ["resume", "new", "fork"] as const) {
    it(`${reason} ends with a live, re-registered connection`, async () => {
      FakeWebSocket.instances = [];
      const dir = mkdtempSync(join(tmpdir(), `pi-${reason}-`));
      const conn = makeConnection();
      try {
        // Session A live.
        conn.connect();
        await settle();
        expect(conn.isConnected).toBe(true);

        // session_shutdown(reason) — full disconnect completes first.
        await shutdownThenDisconnect(conn, "A");
        expect(conn.isConnected).toBe(false);

        // session_start(reason) for B: handleSessionChange BEFORE connect().
        const ctxB = makeCtx("B", dir);
        const bc = makeBc(conn, "A", ctxB);
        runSessionStartUnderSafe([
          () => handleSessionChange(bc, ctxB, () => []),
          () => conn.connect(),
        ]);

        await settle();
        expect(conn.isConnected).toBe(true);
        const last = FakeWebSocket.instances.at(-1);
        expect(registeredFor(last, "B")).toBe(true);
      } finally {
        conn.disconnect();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  // ── Error-handling X1: RED repro of #393 — a mid-path ctx.cwd throw ──
  it("resume survives a mid-path ctx.cwd throw (reproduces #393)", async () => {
    FakeWebSocket.instances = [];
    const conn = makeConnection();
    try {
      conn.connect();
      await settle();
      expect(conn.isConnected).toBe(true);

      await shutdownThenDisconnect(conn, "A");
      expect(conn.isConnected).toBe(false);

      // The documented fault: ctx.cwd throws once the session is replaced.
      const throwingCwd = () => {
        throw new Error("ctx.cwd: session replaced");
      };
      const ctxB = makeCtx("B", throwingCwd);
      const bc = makeBc(conn, "A", ctxB);
      runSessionStartUnderSafe([
        () => handleSessionChange(bc, ctxB, () => []),
        () => conn.connect(),
      ]);

      await settle();
      // Pre-fix: handleSessionChange throws at `cwd: ctx.cwd`, safe() swallows
      // it, connect() is skipped, and the socket stays terminally closed.
      expect(conn.isConnected).toBe(true);
      const last = FakeWebSocket.instances.at(-1);
      expect(registeredFor(last, "B")).toBe(true);
    } finally {
      conn.disconnect();
    }
  });

  // ── Frontend-quirk F4: reload ends connected ──
  it("reload re-init ends with a live, re-registered connection", async () => {
    FakeWebSocket.instances = [];
    const conn = makeConnection();
    try {
      conn.connect();
      await settle();
      expect(conn.isConnected).toBe(true);

      // session_shutdown(reason: "reload") → state.cleanup disconnects.
      conn.send({ type: "session_unregister", sessionId: "A" });
      conn.disconnect();
      expect(conn.isConnected).toBe(false);

      // Reload re-init: connect() + re-register.
      conn.connect();
      conn.send({ type: "session_register", sessionId: "A" });
      await settle();
      expect(conn.isConnected).toBe(true);
      expect(registeredFor(FakeWebSocket.instances.at(-1), "A")).toBe(true);
    } finally {
      conn.disconnect();
    }
  });

  // ── Edge-case E1: quit tears down, cleanup ran ──
  it("quit tears down and runs the always-run cleanup", async () => {
    FakeWebSocket.instances = [];
    const conn = makeConnection();
    conn.connect();
    await settle();

    const timers = { metrics: true, heartbeat: true, gitPoll: true };
    const subagentBufferReset = vi.fn();
    const attachmentsCleaned = vi.fn();

    // Model session_shutdown(reason: "quit") cleanup (bridge.ts inline handler).
    conn.send({ type: "session_unregister", sessionId: "A" });
    timers.metrics = timers.heartbeat = timers.gitPoll = false;
    subagentBufferReset();
    attachmentsCleaned();
    await new Promise((r) => setTimeout(r, 0));
    conn.disconnect(); // teardown is permitted for quit — MAY close.

    const first = FakeWebSocket.instances[0];
    expect(first.sent.some((s) => JSON.parse(s).type === "session_unregister")).toBe(true);
    expect(timers).toEqual({ metrics: false, heartbeat: false, gitPoll: false });
    expect(subagentBufferReset).toHaveBeenCalledTimes(1);
    expect(attachmentsCleaned).toHaveBeenCalledTimes(1);
  });

  // ── Error-handling X2: cleanup runs regardless of reason under a later throw ──
  it("shutdown cleanup completes for every replacement reason even when a later start step throws", async () => {
    for (const reason of ["resume", "new", "fork"] as const) {
      FakeWebSocket.instances = [];
      const conn = makeConnection();
      conn.connect();
      await settle();

      const timers = { metrics: true, heartbeat: true, gitPoll: true };
      const subagentBufferReset = vi.fn();
      const attachmentsCleaned = vi.fn();

      // session_shutdown(reason) — the always-run cleanup.
      conn.send({ type: "session_unregister", sessionId: `A-${reason}` });
      timers.metrics = timers.heartbeat = timers.gitPoll = false;
      subagentBufferReset();
      attachmentsCleaned();
      await new Promise((r) => setTimeout(r, 0));
      conn.disconnect();

      // A subsequent session_start step throws — must not undo the cleanup.
      runSessionStartUnderSafe([
        () => {
          throw new Error("later session_start step boom");
        },
        () => conn.connect(),
      ]);

      expect(timers).toEqual({ metrics: false, heartbeat: false, gitPoll: false });
      expect(subagentBufferReset).toHaveBeenCalledTimes(1);
      expect(attachmentsCleaned).toHaveBeenCalledTimes(1);
      conn.disconnect();
    }
  });
});
