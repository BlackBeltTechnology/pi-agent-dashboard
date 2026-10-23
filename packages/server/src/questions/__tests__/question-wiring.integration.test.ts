/**
 * End-to-end through a real in-process server: bridge socket → event-wiring
 * notify guard → gateway registry → question store → browser `questions_update`.
 * (test-plan #E1 notify creates nothing; add + removal frames over the wire.)
 * Harness modelled on `prompt-derived-tool-state.integration.test.ts`.
 * See change: add-pending-question-stack.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer, type ServerConfig } from "../../server.js";
import { proofWebSocket } from "../../test-support/local-credential-stamp.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("waitFor: condition not met within timeout");
    await wait(20);
  }
}

const baseConfig: ServerConfig = { port: 0, piPort: 0, host: "127.0.0.1", dev: true, autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false };

describe("question stack wiring (integration)", () => {
  let server: DashboardServer;
  let piPort: number;
  let browserPort: number;
  const sockets: WebSocket[] = [];

  async function boot() {
    server = await createServer({ ...baseConfig });
    await server.start();
    browserPort = server.httpPort()!;
    piPort = server.piPort()!;
  }
  afterEach(async () => {
    for (const s of sockets) s.close();
    sockets.length = 0;
    await server.stop();
  });

  async function openBridge(): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    sockets.push(ws);
    return ws;
  }
  const send = (ws: WebSocket, msg: Record<string, unknown>) => ws.send(JSON.stringify(msg));
  async function registerLive(ws: WebSocket, sessionId: string) {
    send(ws, { type: "session_register", sessionId, cwd: "/tmp", source: "cli" });
    send(ws, { type: "replay_complete", sessionId });
    await wait(80);
  }
  async function connectBrowser() {
    const messages: any[] = [];
    const ws = proofWebSocket(`ws://127.0.0.1:${browserPort}/ws`);
    ws.on("message", (raw) => {
      try {
        messages.push(JSON.parse(String(raw)));
      } catch {
        /* ignore */
      }
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    sockets.push(ws);
    await wait(80);
    return messages;
  }
  const qUpdates = (messages: any[]) => messages.filter((m) => m.type === "questions_update");
  const questionFiles = () => {
    const dir = path.join(os.homedir(), ".pi", "dashboard", "questions");
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".json")) : [];
  };
  const promptRequest = (sessionId: string, promptId: string, prompt: Record<string, unknown>) =>
    ({ type: "prompt_request", sessionId, promptId, prompt, component: { type: "x", props: {} }, placement: "inline" });

  it("notify-shaped requests create nothing (test-plan #E1); real asks are listed and removed", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "qs1");
    const messages = await connectBrowser();
    expect(qUpdates(messages).at(-1)).toEqual({ type: "questions_update", questions: [] }); // initial frame
    const baseline = qUpdates(messages).length;

    // Legacy notify-shaped prompt_request (version-skew guard path).
    send(bridge, promptRequest("qs1", "n1", { type: "notify", question: "heads up", pipeline: "x" }));
    await wait(450); // longer than the 250 ms add debounce
    expect(qUpdates(messages).length).toBe(baseline);
    expect(questionFiles()).toEqual([]);

    // A real ask appears (debounced add) …
    send(bridge, promptRequest("qs1", "p1", { type: "select", question: "Resume or hand back?", options: ["Resume", "Hand back"], pipeline: "x" }));
    await waitFor(() => qUpdates(messages).at(-1)?.questions?.length === 1);
    const row = qUpdates(messages).at(-1).questions[0];
    expect(row).toMatchObject({ sessionId: "qs1", type: "select", preview: "Resume or hand back?" });
    expect(row.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(questionFiles()).toHaveLength(1);

    // … and the bridge's prompt_dismiss removes it.
    send(bridge, { type: "prompt_dismiss", sessionId: "qs1", promptId: "p1" });
    await waitFor(() => qUpdates(messages).at(-1)?.questions?.length === 0);
    expect(questionFiles()).toEqual([]);
  });

  it("a session that dies holding a question removes it (death path)", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "qs2");
    const messages = await connectBrowser();
    send(bridge, promptRequest("qs2", "p1", { type: "confirm", question: "Proceed?", pipeline: "x" }));
    await waitFor(() => qUpdates(messages).at(-1)?.questions?.length === 1);
    server.sessionManager.unregister("qs2"); // same seam the bridge-unregister / reaper paths end through
    await waitFor(() => qUpdates(messages).at(-1)?.questions?.length === 0);
    expect(questionFiles()).toEqual([]);
  });
});
