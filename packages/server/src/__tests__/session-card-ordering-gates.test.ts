/**
 * Integration: gated status-transition placement (change:
 * simplify-session-card-ordering). Drives a real server + pi bridge WS +
 * browser WS, asserting `sessions_reordered` broadcasts under the
 * completedFirst / questionFirst gates.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createServer, type DashboardServer, type ServerConfig } from "../server.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll a predicate until true or timeout. Replaces fixed sleeps so the
 * positive-reorder assertions don't flake on slow/busy CI hosts.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 2000, intervalMs = 20): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("waitFor: condition not met within timeout");
    }
    await wait(intervalMs);
  }
}

async function connectSession(piPort: number, sessionId: string, cwd = "/tmp"): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
  await new Promise<void>((resolve) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "session_register", sessionId, cwd, source: "cli" }));
      ws.send(JSON.stringify({ type: "replay_complete", sessionId }));
      setTimeout(resolve, 50);
    });
  });
  return ws;
}

/** Connect a browser WS and collect every `sessions_reordered` message. */
async function connectBrowser(browserPort: number): Promise<{ ws: WebSocket; reorders: any[] }> {
  const reorders: any[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${browserPort}/ws`);
  ws.on("message", (raw) => {
    try {
      const m = JSON.parse(String(raw));
      if (m.type === "sessions_reordered") reorders.push(m);
    } catch { /* ignore */ }
  });
  await new Promise<void>((resolve) => ws.on("open", () => setTimeout(resolve, 50)));
  return { ws, reorders };
}

function fwd(ws: WebSocket, sessionId: string, eventType: string, data: Record<string, unknown> = {}) {
  ws.send(JSON.stringify({ type: "event_forward", sessionId, event: { eventType, timestamp: Date.now(), data } }));
}

const baseConfig: ServerConfig = {
  port: 0,
  piPort: 0,
  host: "127.0.0.1",
  dev: true,
  autoShutdown: false,
  shutdownIdleSeconds: 999,
  tunnel: false,
};

describe("session-card ordering gates (integration)", () => {
  let server: DashboardServer;
  let piPort: number;
  let browserPort: number;
  const sockets: WebSocket[] = [];

  async function boot(extra: Partial<ServerConfig>) {
    server = await createServer({ ...baseConfig, ...extra });
    await server.start();
    browserPort = server.httpPort()!;
    piPort = server.piPort()!;
  }

  afterEach(async () => {
    for (const s of sockets) s.close();
    sockets.length = 0;
    await server.stop();
  });

  it("completedFirst ON: agent_end on an alive session moves it to top of active", async () => {
    await boot({ completedFirst: true });
    const s1 = await connectSession(piPort, "s1");
    const s2 = await connectSession(piPort, "s2");
    sockets.push(s1, s2);
    // Order after register (prepend): [s2, s1].
    const { ws: browser, reorders } = await connectBrowser(browserPort);
    sockets.push(browser);

    fwd(s1, "s1", "agent_end");
    await waitFor(() => reorders.length > 0);

    const last = reorders[reorders.length - 1];
    expect(last.cwd).toBe("/tmp");
    expect(last.sessionIds[0]).toBe("s1"); // moved to front of active
  });

  it("questionFirst ON: ask_user request moves the session to top of active", async () => {
    await boot({ questionFirst: true });
    const s1 = await connectSession(piPort, "s1");
    const s2 = await connectSession(piPort, "s2");
    sockets.push(s1, s2);
    const { ws: browser, reorders } = await connectBrowser(browserPort);
    sockets.push(browser);

    // currentTool flips to "ask_user" via tool_execution_start.
    fwd(s1, "s1", "tool_execution_start", { toolName: "ask_user" });
    await waitFor(() => reorders.length > 0);

    const last = reorders[reorders.length - 1];
    expect(last.sessionIds[0]).toBe("s1");
  });

  it("gates OFF: agent_end + ask_user do NOT reorder", async () => {
    await boot({ completedFirst: false, questionFirst: false });
    const s1 = await connectSession(piPort, "s1");
    const s2 = await connectSession(piPort, "s2");
    sockets.push(s1, s2);
    const { ws: browser, reorders } = await connectBrowser(browserPort);
    sockets.push(browser);

    fwd(s1, "s1", "agent_end");
    fwd(s1, "s1", "tool_execution_start", { toolName: "ask_user" });
    // No condition to await for a negative assertion; give the server ample
    // time to (not) emit, then assert nothing was broadcast.
    await wait(300);

    expect(reorders).toHaveLength(0);
  });

  it("completedFirst ON: alive→ended keeps the id in the order and surfaces it (no remove)", async () => {
    await boot({ completedFirst: true });
    const s1 = await connectSession(piPort, "s1");
    const s2 = await connectSession(piPort, "s2");
    sockets.push(s1, s2);
    const { ws: browser, reorders } = await connectBrowser(browserPort);
    sockets.push(browser);

    // Drive alive→ended deterministically via the session manager (onChange
    // hook fires the gated placement). onChange persists meta, so the
    // session needs a real sessionFile path.
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-order-test-"));
    const sessionFile = path.join(tmpDir, "s2.jsonl");
    writeFileSync(sessionFile, "");
    server.sessionManager.update("s2", { sessionFile, status: "ended", endedAt: Date.now() });
    await waitFor(() => reorders.length > 0);

    const last = reorders[reorders.length - 1];
    expect(last.sessionIds).toContain("s2"); // id RETAINED (not removed)
    expect(last.sessionIds[0]).toBe("s2"); // top of (ended) tier
  });
});
