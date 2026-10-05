/**
 * Integration: `awaitingFileAccess` derived from the pending-prompt registry for
 * agent path-gate prompts; `currentTool` is left untouched.
 * See change: ask-agent-file-access-in-chat — test-plan #X10, #X11.
 */
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer, type ServerConfig } from "../server.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const baseConfig: ServerConfig = {
  port: 0, piPort: 0, host: "127.0.0.1", dev: true, autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
};

describe("awaitingFileAccess (integration)", () => {
  let server: DashboardServer;
  let piPort: number;
  let browserPort: number;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const s of sockets) s.close();
    sockets.length = 0;
    await server.stop();
  });

  async function boot() {
    server = await createServer({ ...baseConfig });
    await server.start();
    browserPort = server.httpPort()!;
    piPort = server.piPort()!;
  }
  async function openBridge(): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    sockets.push(ws);
    return ws;
  }
  const send = (ws: WebSocket, msg: Record<string, unknown>) => ws.send(JSON.stringify(msg));
  async function registerLive(ws: WebSocket, id: string) {
    send(ws, { type: "session_register", sessionId: id, cwd: "/tmp", source: "cli" });
    send(ws, { type: "replay_complete", sessionId: id });
    await wait(80);
  }
  const gatePrompt = (ws: WebSocket, id: string, promptId: string, kind = "agent-path-gate") =>
    send(ws, {
      type: "prompt_request", sessionId: id, promptId,
      prompt: { question: "q", type: "select", options: ["Allow once", "Deny"], metadata: { kind, path: "/etc/hostname" } },
      component: { type: "generic-dialog", props: {} }, placement: "inline",
    });
  async function session(id: string): Promise<Record<string, any> | undefined> {
    const res = await fetch(`http://127.0.0.1:${browserPort}/api/sessions`);
    return ((await res.json()) as { data: any[] }).data.find((s) => s.id === id);
  }

  it("X10 true while pending, false after disconnect, true again after replay; currentTool unchanged", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "s1");
    send(bridge, { type: "event_forward", sessionId: "s1", event: { eventType: "tool_execution_start", timestamp: Date.now(), data: { type: "tool_execution_start", toolName: "read" } } });
    await wait(60);
    gatePrompt(bridge, "s1", "p1");
    await wait(120);
    let s = await session("s1");
    expect(s?.awaitingFileAccess).toBe(true);
    expect(s?.currentTool).toBe("read");

    bridge.close();
    await wait(300);
    s = await session("s1");
    expect(s?.awaitingFileAccess ?? false).toBe(false);

    const again = await openBridge();
    send(again, { type: "session_register", sessionId: "s1", cwd: "/tmp", source: "cli" });
    gatePrompt(again, "s1", "p1"); // replay burst
    send(again, { type: "replay_complete", sessionId: "s1" });
    await wait(200);
    s = await session("s1");
    expect(s?.awaitingFileAccess).toBe(true);
  });

  it("X11 a sibling tool start keeps the flag; dismiss clears it", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "s1");
    gatePrompt(bridge, "s1", "p1");
    await wait(100);
    send(bridge, { type: "event_forward", sessionId: "s1", event: { eventType: "tool_execution_start", timestamp: Date.now(), data: { type: "tool_execution_start", toolName: "grep" } } });
    await wait(100);
    let s = await session("s1");
    expect(s?.awaitingFileAccess).toBe(true);
    expect(s?.currentTool).toBe("grep");
    send(bridge, { type: "prompt_dismiss", sessionId: "s1", promptId: "p1" });
    await wait(120);
    s = await session("s1");
    expect(s?.awaitingFileAccess ?? false).toBe(false);
  });

  it("review B5: bridge disconnect + re-register + replay restores the flag, re-delivers the SAME prompt to a subscribed browser, and its answer reaches the new bridge socket", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "s1");
    send(bridge, { type: "event_forward", sessionId: "s1", event: { eventType: "tool_execution_start", timestamp: Date.now(), data: { type: "tool_execution_start", toolName: "read" } } });
    await wait(60);
    const browser = new WebSocket(`ws://127.0.0.1:${browserPort}/ws`);
    sockets.push(browser);
    const frames: any[] = [];
    browser.on("message", (raw) => { try { frames.push(JSON.parse(String(raw))); } catch { /* ignore */ } });
    await new Promise<void>((resolve) => browser.on("open", () => resolve()));
    browser.send(JSON.stringify({ type: "subscribe", sessionId: "s1" }));
    await wait(100);

    gatePrompt(bridge, "s1", "p1");
    await wait(150);
    expect(frames.some((f) => f.type === "session_updated" && f.sessionId === "s1" && f.updates?.awaitingFileAccess === true)).toBe(true);

    // Bridge link drops: the flag clears (the prompt cannot be answered through a closed bridge).
    frames.length = 0;
    bridge.close();
    await wait(300);
    expect(frames.some((f) => f.type === "session_updated" && f.updates?.awaitingFileAccess === false)).toBe(true);

    // The bridge re-registers and replays the still-pending prompt.
    frames.length = 0;
    const again = await openBridge();
    const answers: any[] = [];
    again.on("message", (raw) => { try { answers.push(JSON.parse(String(raw))); } catch { /* ignore */ } });
    send(again, { type: "session_register", sessionId: "s1", cwd: "/tmp", source: "cli" });
    // The replay burst re-sends the in-flight tool event and the still-pending prompt.
    send(again, { type: "event_forward", sessionId: "s1", event: { eventType: "tool_execution_start", timestamp: Date.now(), data: { type: "tool_execution_start", toolName: "read" } } });
    gatePrompt(again, "s1", "p1");
    send(again, { type: "replay_complete", sessionId: "s1" });
    await wait(300);
    expect((await session("s1"))?.awaitingFileAccess).toBe(true);
    // review r5/B1: replay reconciliation must NOT fold a file-access prompt into currentTool.
    expect((await session("s1"))?.currentTool).toBe("read");
    expect(frames.some((f) => f.type === "session_updated" && f.sessionId === "s1" && f.updates?.awaitingFileAccess === true)).toBe(true);
    const replayed = frames.find((f) => f.type === "prompt_request" && f.promptId === "p1");
    expect(replayed?.prompt?.metadata?.kind).toBe("agent-path-gate");

    // The card is still answerable: the browser's answer is routed to the NEW bridge socket.
    browser.send(JSON.stringify({ type: "prompt_response", sessionId: "s1", promptId: "p1", answer: "Allow once" }));
    await wait(200);
    expect(answers.some((m) => m.type === "prompt_response" && m.promptId === "p1" && m.answer === "Allow once")).toBe(true);
  });

  it("review r5/B1: a gate prompt arriving with NO tool in flight does not fold currentTool to ask_user (live or after replay); an ordinary prompt still does", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "s1");
    gatePrompt(bridge, "s1", "p1");
    await wait(150);
    let s = await session("s1");
    expect(s?.awaitingFileAccess).toBe(true);
    expect(s?.currentTool ?? null).toBeNull();
    // still pending after the answer of a DIFFERENT, ordinary prompt: that one folds and clears alone
    send(bridge, { type: "prompt_request", sessionId: "s1", promptId: "q1", prompt: { question: "q", type: "select", options: ["a"] }, component: { type: "generic-dialog", props: {} }, placement: "inline" });
    await wait(150);
    expect((await session("s1"))?.currentTool).toBe("ask_user");
    send(bridge, { type: "prompt_dismiss", sessionId: "s1", promptId: "q1" });
    await wait(150);
    s = await session("s1");
    expect(s?.currentTool ?? null).toBeNull(); // cleared although the gate prompt is still pending
    expect(s?.awaitingFileAccess).toBe(true);
  });

  it("a non-gate prompt never sets the flag", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "s1");
    gatePrompt(bridge, "s1", "p1", "something-else");
    await wait(100);
    expect((await session("s1"))?.awaitingFileAccess ?? false).toBe(false);
  });
});
