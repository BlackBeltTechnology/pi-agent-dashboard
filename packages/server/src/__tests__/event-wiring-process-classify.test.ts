/**
 * End-to-end: a `process_list` from a bridge is forwarded to subscribed
 * browsers as `process_list_update` with each entry classified. A `pi` pid
 * matching a connected session becomes `kind: "sub-session"` + `sessionRef`;
 * a context-mode bun entry becomes `kind: "plugin"`. Late subscribers replay
 * the stored, already-classified entries.
 * See change: classify-process-list-entries.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function connectSession(piPort: number, sessionId: string, pid?: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
  await new Promise<void>((resolve) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "session_register", sessionId, cwd: "/tmp", source: "cli", pid }));
      ws.send(JSON.stringify({ type: "replay_complete", sessionId }));
      setTimeout(resolve, 60);
    });
  });
  return ws;
}

async function connectBrowser(browserPort: number, sessionId: string, sink: any[]): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${browserPort}/ws`);
  // Attach the message listener synchronously so the `sessions_snapshot`
  // sent on connect (the replay path for stored processes) is captured.
  ws.on("message", (raw) => {
    try { sink.push(JSON.parse(raw.toString())); } catch { /* ignore */ }
  });
  await new Promise<void>((resolve) => ws.on("open", () => resolve()));
  ws.send(JSON.stringify({ type: "subscribe", sessionId, lastSeq: 0 }));
  await wait(60);
  return ws;
}

describe("process_list classification — server wiring", () => {
  let server: DashboardServer;
  let piPort: number;
  let browserPort: number;

  beforeEach(async () => {
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
    browserPort = server.httpPort()!;
    piPort = server.piPort()!;
  });

  afterEach(async () => {
    await server.stop();
  });

  it("forwards a pi pid as sub-session and a context-mode entry as plugin", async () => {
    // A child session whose pid the parent's process_list will reference.
    const childWs = await connectSession(piPort, "child", 4242);
    const parentWs = await connectSession(piPort, "parent");

    const msgs: any[] = [];
    const browserWs = await connectBrowser(browserPort, "parent", msgs);
    msgs.length = 0;

    parentWs.send(JSON.stringify({
      type: "process_list",
      sessionId: "parent",
      processes: [
        { pid: 4242, pgid: 4242, command: "pi", elapsedMs: 60000 },
        { pid: 51, pgid: 51, command: "bun /Users/x/.pi/agent/npm/node_modules/context-mode/server.bundle.mjs", elapsedMs: 60000 },
        { pid: 60, pgid: 60, command: "node vite --watch", elapsedMs: 60000 },
      ],
    }));
    await wait(80);

    const update = msgs.filter((m) => m.type === "process_list_update").pop();
    expect(update).toBeDefined();
    const byPid = Object.fromEntries(update.processes.map((p: any) => [p.pid, p]));

    expect(byPid[4242].kind).toBe("sub-session");
    expect(byPid[4242].sessionRef).toBe("child");
    expect(byPid[51].kind).toBe("plugin");
    expect(byPid[51].label).toBe("context-mode");
    expect(byPid[60].kind).toBe("task");

    childWs.close();
    parentWs.close();
    browserWs.close();
  });

  it("replays stored classified entries to a late subscriber", async () => {
    await connectSession(piPort, "child", 4242);
    const parentWs = await connectSession(piPort, "parent");

    parentWs.send(JSON.stringify({
      type: "process_list",
      sessionId: "parent",
      processes: [{ pid: 4242, pgid: 4242, command: "pi", elapsedMs: 60000 }],
    }));
    await wait(80);

    // Late browser subscribes AFTER the process_list was processed.
    const msgs: any[] = [];
    const browserWs = await connectBrowser(browserPort, "parent", msgs);
    await wait(80);

    const snapshot = msgs.find((m) => m.type === "sessions_snapshot");
    const parent = snapshot?.sessions?.find((s: any) => s.id === "parent");
    expect(parent?.processes?.[0]?.kind).toBe("sub-session");
    expect(parent?.processes?.[0]?.sessionRef).toBe("child");

    browserWs.close();
  });
});
