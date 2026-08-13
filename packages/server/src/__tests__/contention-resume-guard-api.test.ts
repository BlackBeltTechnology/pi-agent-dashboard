/**
 * The session-file-keyed resume guard and the contended-prompt annotation, at
 * the REST surface with a real bridge socket attached.
 *
 * Covers test-plan #X12 (REST resume refused), #X14 (zombie still resumable),
 * #X17 (no sessionFile never refuses), #X18 (fork exempt) and #F1/#F3 (prompt
 * honesty).
 *
 * See change: fix-duplicate-bridge-registration (D4, D5).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";

let httpPort: number;
let piPort: number;
let server: DashboardServer;

const { spawnCalls } = vi.hoisted(() => ({ spawnCalls: [] as unknown[] }));

vi.mock("../spawn-process/process-manager.js", async (importOriginal) => {
  const orig: any = await importOriginal();
  return {
    ...orig,
    spawnPiSession: vi.fn(async (...args: unknown[]) => {
      spawnCalls.push(args);
      return { success: true, message: "spawned" };
    }),
    getKeeperManager: () => ({
      ...orig.getKeeperManager(),
      isKeeperAlive: () => false,
    }),
  };
});

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function url(path: string) {
  return `http://127.0.0.1:${httpPort}${path}`;
}

async function postJson(path: string, body?: Record<string, unknown>) {
  return fetch(url(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

const sockets: WebSocket[] = [];

/** Connect a bridge socket and register `sessionId`, waiting until it routes. */
async function connectBridge(sessionId: string, extra: Record<string, unknown> = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
  ws.on("error", () => {});
  sockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
  ws.send(
    JSON.stringify({ type: "session_register", sessionId, cwd: "/tmp/test", source: "tui", ...extra }),
  );
  // The register has landed once the manager reflects the bridge's own source.
  for (let i = 0; i < 300; i++) {
    if (server.sessionManager.get(sessionId)?.source === "tui") {
      await delay(20);
      return ws;
    }
    await delay(10);
  }
  throw new Error(`bridge for ${sessionId} never registered`);
}

/** Live bridge count, read through the same surface an operator would use. */
async function bridgeCount(): Promise<number> {
  const res = await fetch(url("/api/health"));
  return ((await res.json()) as any).activeBridgeCount as number;
}

describe("session-file resume guard (REST)", () => {
  beforeAll(async () => {
    server = await createServer({
      port: 0,
      piPort: 0,
      host: "127.0.0.1",
      dev: true,
      autoShutdown: false,
      shutdownIdleSeconds: 999,
      tunnel: false,
    });
    await server.start();
    httpPort = server.httpPort()!;
    piPort = server.piPort()!;
  });

  afterAll(async () => {
    for (const ws of sockets) ws.terminate();
    if (server) {
      try {
        await server.stop();
      } catch {
        /* */
      }
    }
  });

  afterEach(() => {
    spawnCalls.length = 0;
  });

  // ── X12 ───────────────────────────────────────────────────────────────────
  it("X12: refuses a continue whose session file a live bridge serves under another id", async () => {
    // B is live and owns the file.
    await connectBridge("live-B", { sessionFile: "/t/shared.jsonl", pid: 4242 });

    // A is a separate, ended session recorded against the SAME file.
    server.sessionManager.register({
      id: "ended-A",
      cwd: "/tmp/test",
      source: "tui" as const,
      sessionFile: "/t/shared.jsonl",
      startedAt: Date.now(),
    });
    server.sessionManager.update("ended-A", { status: "ended", endedAt: Date.now() });

    const res = await postJson("/api/session/ended-A/resume", { mode: "continue" });
    const body = (await res.json()) as any;

    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toContain("live-B");
    // No pi was spawned.
    expect(spawnCalls).toHaveLength(0);
  }, 25000);

  // ── X18 ───────────────────────────────────────────────────────────────────
  it("X18: a fork of the same live session file proceeds \u2014 the guard is continue-only", async () => {
    const res = await postJson("/api/session/ended-A/resume", { mode: "fork" });
    const body = (await res.json()) as any;

    expect(res.status).not.toBe(409);
    expect(body.error ?? "").not.toContain("already served");
  }, 25000);

  // ── X14 ───────────────────────────────────────────────────────────────────
  it("X14: once the holder's bridge is gone the same continue proceeds", async () => {
    // A non-automation close deliberately leaves the map entry in place for the
    // reconnect grace window, so `activeBridgeCount` does NOT drop here. The
    // guard keys on D1 liveness, which follows `readyState` — wait for that.
    const holder = sockets.find((s) => s.readyState === WebSocket.OPEN)!;
    holder.close();
    for (let i = 0; i < 300; i++) {
      if (holder.readyState === WebSocket.CLOSED) break;
      await delay(10);
    }
    await delay(50);

    const res = await postJson("/api/session/ended-A/resume", { mode: "continue" });
    const body = (await res.json()) as any;

    expect(body.error ?? "").not.toContain("already served by live session");
  }, 25000);

  // ── X17 ───────────────────────────────────────────────────────────────────
  it("X17: a live session with no sessionFile never triggers the guard", async () => {
    await connectBridge("no-file", { pid: 7 });

    server.sessionManager.register({
      id: "other",
      cwd: "/tmp/test",
      source: "tui" as const,
      sessionFile: "/t/other.jsonl",
      startedAt: Date.now(),
    });
    server.sessionManager.update("other", { status: "ended", endedAt: Date.now() });

    const res = await postJson("/api/session/other/resume", { mode: "continue" });
    const body = (await res.json()) as any;
    expect(body.error ?? "").not.toContain("already served by live session");
  }, 25000);

  // ── F3 / F1 ───────────────────────────────────────────────────────────────
  it("F3: an uncontended prompt is a plain success", async () => {
    await connectBridge("plain", { pid: 11, sessionFile: "/t/plain.jsonl" });

    const res = await postJson("/api/session/plain/prompt", { text: "hi" });
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true });
  }, 25000);

  it("F1: a contended prompt is annotated, names the bridge state, and reports delivery", async () => {
    await connectBridge("contended", { pid: 37660, sessionFile: "/t/c.jsonl" });

    // A second bridge claims the same id and loses.
    const dup = new WebSocket(`ws://127.0.0.1:${piPort}`);
    dup.on("error", () => {});
    sockets.push(dup);
    await new Promise<void>((r) => dup.on("open", () => r()));
    const closed = new Promise<void>((r) => dup.on("close", () => r()));
    dup.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "contended",
        cwd: "/tmp/test",
        source: "tui",
        pid: 17579,
        sessionFile: "/t/c.jsonl",
      }),
    );
    await closed;

    const res = await postJson("/api/session/contended/prompt", { text: "hi" });
    const body = (await res.json()) as any;

    // Not a plain success …
    expect(body).not.toEqual({ success: true });
    // … but explicitly delivered, so a caller does not retry and double-send.
    expect(body.success).toBe(true);
    expect(body.delivered).toBe(true);
    expect(body.bridgeState).toBe("contended");
    expect(body.warning).toContain("37660");
    expect(body.warning).toContain("17579");
  }, 25000);

  // ── F7 ────────────────────────────────────────────────────────────────────
  it("F7: /api/health carries the cumulative count and the contended id list", async () => {
    const res = await fetch(url("/api/health"));
    const body = (await res.json()) as any;

    expect(body.bridgeContentionCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.contendedSessionIds)).toBe(true);
    expect(body.contendedSessionIds).toContain("contended");
  }, 25000);
});
