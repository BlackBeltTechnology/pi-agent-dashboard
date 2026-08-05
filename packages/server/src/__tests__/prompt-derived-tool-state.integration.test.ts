/**
 * Integration: `currentTool` derived from the PromptBus registry.
 *
 * Drives a real in-process server over a raw bridge WebSocket, so the replay
 * window (`session_register` … `replay_complete`) can be scripted exactly and
 * the two mechanisms can be observed separately:
 *   M1 — the live-only fold inside `extractSessionUpdates`
 *   M2 — the direct writes in the `prompt_*` branches
 * plus the reconcile → recompute → drain that runs at each replay exit.
 *
 * Harness modelled on `session-card-ordering-gates.test.ts`.
 *
 * See change: restore-ask-user-tool-state-on-reconnect, test-plan
 * #E9–#E12, #X1–#X5, #F1, #R1–#R7.
 */
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer, type ServerConfig } from "../server.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 3000, intervalMs = 20): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("waitFor: condition not met within timeout");
    }
    await wait(intervalMs);
  }
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

describe("prompt-derived currentTool (integration)", () => {
  let server: DashboardServer;
  let piPort: number;
  let browserPort: number;
  const sockets: WebSocket[] = [];

  async function boot(extra: Partial<ServerConfig> = {}) {
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

  /** Open a bridge socket WITHOUT registering — the caller drives the window. */
  async function openBridge(): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    sockets.push(ws);
    return ws;
  }

  function send(ws: WebSocket, msg: Record<string, unknown>) {
    ws.send(JSON.stringify(msg));
  }

  function register(ws: WebSocket, sessionId: string, cwd = "/tmp") {
    send(ws, { type: "session_register", sessionId, cwd, source: "cli" });
  }

  function replayComplete(ws: WebSocket, sessionId: string) {
    send(ws, { type: "replay_complete", sessionId });
  }

  function fwd(ws: WebSocket, sessionId: string, eventType: string, data: Record<string, unknown> = {}) {
    send(ws, {
      type: "event_forward",
      sessionId,
      event: { eventType, timestamp: Date.now(), data: { type: eventType, ...data } },
    });
  }

  function promptRequest(ws: WebSocket, sessionId: string, promptId: string, extra: Record<string, unknown> = {}) {
    send(ws, {
      type: "prompt_request",
      sessionId,
      promptId,
      method: "ask_user",
      params: { title: `q-${promptId}` },
      ...extra,
    });
  }

  /** Register + drain the replay window, leaving the session fully live. */
  async function registerLive(ws: WebSocket, sessionId: string, cwd = "/tmp") {
    register(ws, sessionId, cwd);
    replayComplete(ws, sessionId);
    await wait(80);
  }

  /** Current server-side view of a session, read over the same REST API the browser uses. */
  async function getSession(sessionId: string): Promise<Record<string, any> | undefined> {
    const res = await fetch(`http://127.0.0.1:${browserPort}/api/sessions`);
    const body = (await res.json()) as { success: boolean; data: any[] };
    return body.data.find((s) => s.id === sessionId);
  }

  async function expectCurrentTool(sessionId: string, expected: string | null) {
    const session = await getSession(sessionId);
    expect(session, `session ${sessionId} should exist`).toBeDefined();
    expect(session!.currentTool ?? null).toBe(expected);
  }

  /** Browser socket collecting every message, subscribed to `sessionId`. */
  async function connectBrowser(sessionId?: string): Promise<{ ws: WebSocket; messages: any[] }> {
    const messages: any[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${browserPort}/ws`);
    ws.on("message", (raw) => {
      try {
        messages.push(JSON.parse(String(raw)));
      } catch {
        /* ignore non-JSON frames */
      }
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    if (sessionId) ws.send(JSON.stringify({ type: "subscribe", sessionId }));
    await wait(80);
    sockets.push(ws);
    return { ws, messages };
  }

  const toolUpdates = (messages: any[], sessionId: string) =>
    messages.filter(
      (m) => m.type === "session_updated" && m.sessionId === sessionId && m.updates && "currentTool" in m.updates,
    );

  // ── M2: direct writes in the prompt_* branches ──

  it("#E12 a flow-raised prompt with no ask_user tool call sets currentTool", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "s1");
    // No `tool_execution_start` at all, and a widget-bar placement — neither
    // gates the derivation (accepted D7 outcome).
    promptRequest(bridge, "s1", "p1", { placement: "widget-bar" });
    await wait(120);
    await expectCurrentTool("s1", "ask_user");
  });

  it("#E9 stays ask_user while a second prompt is still tracked", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "s1");
    promptRequest(bridge, "s1", "p1");
    promptRequest(bridge, "s1", "p2");
    await wait(120);
    await expectCurrentTool("s1", "ask_user");

    send(bridge, { type: "prompt_cancel", sessionId: "s1", promptId: "p1" });
    await wait(120);
    await expectCurrentTool("s1", "ask_user");
  });

  it("#E10 clears to literal null when the last prompt resolves", async () => {
    await boot();
    const bridge = await openBridge();
    const { messages } = await connectBrowser("s1");
    await registerLive(bridge, "s1");
    promptRequest(bridge, "s1", "p1");
    await wait(120);
    await expectCurrentTool("s1", "ask_user");

    send(bridge, { type: "prompt_dismiss", sessionId: "s1", promptId: "p1" });
    await wait(150);
    await expectCurrentTool("s1", null);

    // The cleared value must travel as literal `null`, not `undefined` —
    // `undefined` is dropped by JSON serialisation and the browser would keep
    // the stale "ask_user".
    const cleared = toolUpdates(messages, "s1").filter((m) => m.updates.currentTool === null);
    expect(cleared.length).toBeGreaterThan(0);
    expect(Object.hasOwn(cleared[cleared.length - 1].updates, "currentTool")).toBe(true);
  });

  it("#E11 a resolve never stomps a genuine in-flight tool", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "s1");
    promptRequest(bridge, "s1", "p1");
    await wait(100);
    // A real tool starts while the prompt is still tracked — it wins (D3).
    fwd(bridge, "s1", "tool_execution_start", { toolName: "bash" });
    await wait(100);
    await expectCurrentTool("s1", "bash");

    send(bridge, { type: "prompt_dismiss", sessionId: "s1", promptId: "p1" });
    await wait(150);
    await expectCurrentTool("s1", "bash");
  });

  it("#E4 a live tool beats the registry even while a prompt is pending", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "s1");
    promptRequest(bridge, "s1", "p1");
    await wait(100);
    fwd(bridge, "s1", "tool_execution_start", { toolName: "Read" });
    await wait(100);
    await expectCurrentTool("s1", "Read");
  });

  it("#R7 a live prompt_request publishes the currentTool change to subscribers", async () => {
    await boot();
    const bridge = await openBridge();
    const { messages } = await connectBrowser("s1");
    await registerLive(bridge, "s1");
    messages.length = 0;

    promptRequest(bridge, "s1", "p1");
    await waitFor(() => toolUpdates(messages, "s1").some((m) => m.updates.currentTool === "ask_user"));
  });

  // ── M1: the fold is live-only ──

  it("#R1 the fold does not run during replay — a replayed agent_end derives null", async () => {
    await boot();
    const bridge = await openBridge();
    // Establish the session and a tracked prompt while live…
    await registerLive(bridge, "s1");
    promptRequest(bridge, "s1", "p1");
    await wait(120);
    await expectCurrentTool("s1", "ask_user");

    // …then re-enter a replay window WITHOUT re-sending the prompt. The stored
    // `agent_end` must derive `null` from the event alone; had the fold run
    // during replay it would have written "ask_user" from the stale registry.
    register(bridge, "s1");
    await wait(60);
    fwd(bridge, "s1", "agent_end");
    await wait(120);
    await expectCurrentTool("s1", null);
  });

  it("#R3 the replay-exit recompute preserves a live tool when the registry reconciles empty", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "s1");

    register(bridge, "s1");
    await wait(60);
    fwd(bridge, "s1", "tool_execution_start", { toolName: "Read" });
    await wait(60);
    replayComplete(bridge, "s1");
    await wait(150);
    // Registry empty ⇒ leave the event-derived value untouched.
    await expectCurrentTool("s1", "Read");
  });

  it("#R4 the replay-exit recompute yields null honestly when nothing is pending", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "s1");

    register(bridge, "s1");
    await wait(60);
    fwd(bridge, "s1", "agent_end");
    await wait(60);
    replayComplete(bridge, "s1");
    await wait(150);
    await expectCurrentTool("s1", null);
  });

  // ── The reconnect sequence end to end ──

  it("#F1 converges to ask_user across register → prompt_request → replay_complete → agent_start", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "s1");

    // The bridge's reconnect burst, in the exact order bridge.ts emits it.
    register(bridge, "s1");
    await wait(60);
    promptRequest(bridge, "s1", "p1");
    await wait(60);
    replayComplete(bridge, "s1");
    await wait(100);
    // The trailing synthetic agent_start is what used to destroy the state.
    fwd(bridge, "s1", "agent_start");
    await wait(150);

    const session = await getSession("s1");
    expect(session!.currentTool).toBe("ask_user");
    expect(session!.status).toBe("streaming");
  });

  it("#R5 a mid-turn session keeps ask_user through the trailing synthetic agent_start", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "s1");

    register(bridge, "s1");
    await wait(60);
    promptRequest(bridge, "s1", "p1");
    replayComplete(bridge, "s1");
    await wait(120);
    await expectCurrentTool("s1", "ask_user");

    fwd(bridge, "s1", "agent_start");
    await wait(120);
    // The live fold covers the post-exit event.
    await expectCurrentTool("s1", "ask_user");
  });

  it("#R6 a prompt_request inside the replay window is not broadcast; replay_complete carries the value", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "s1");
    const { messages } = await connectBrowser("s1");

    register(bridge, "s1");
    await wait(60);
    messages.length = 0;
    promptRequest(bridge, "s1", "p1");
    await wait(150);

    // No session_updated carrying currentTool for the replaying message.
    expect(toolUpdates(messages, "s1")).toHaveLength(0);

    replayComplete(bridge, "s1");
    await waitFor(() => toolUpdates(messages, "s1").some((m) => m.updates.currentTool === "ask_user"));
  });

  // ── Reconcile at the replay exit ──

  it("#X1 a lost dismiss is recovered: an entry the bridge does not re-send is dropped", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "s1");
    promptRequest(bridge, "s1", "lost");
    await wait(120);
    await expectCurrentTool("s1", "ask_user");

    // Reconnect re-sending nothing — the stale entry must not survive.
    register(bridge, "s1");
    await wait(60);
    replayComplete(bridge, "s1");
    await wait(150);
    await expectCurrentTool("s1", null);
  });

  it("#X2 a partially re-sent set keeps the re-sent prompt and drops the rest", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "s1");
    promptRequest(bridge, "s1", "kept");
    promptRequest(bridge, "s1", "dropped");
    await wait(120);

    register(bridge, "s1");
    await wait(60);
    promptRequest(bridge, "s1", "kept");
    replayComplete(bridge, "s1");
    await wait(150);
    await expectCurrentTool("s1", "ask_user");

    // Only "kept" survived: resolving it empties the registry.
    send(bridge, { type: "prompt_dismiss", sessionId: "s1", promptId: "kept" });
    await wait(150);
    await expectCurrentTool("s1", null);
  });

  // ── Registry lifecycle on session death ──

  it("#X7/#X8 unregistering a session clears both pending registries", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "s1");
    await registerLive(bridge, "s2");
    promptRequest(bridge, "s1", "p1");
    promptRequest(bridge, "s2", "p2");
    await wait(120);
    expect(server.browserGateway.hasPendingPromptRequests("s1")).toBe(true);

    server.sessionManager.unregister("s1");
    await wait(120);

    // Without this cleanup the leaked entry is a permanent `hasPendingAsk:
    // true` — the reaper could then never reclaim the dead session.
    expect(server.browserGateway.hasPendingPromptRequests("s1")).toBe(false);
    // A sibling session's prompts are untouched.
    expect(server.browserGateway.hasPendingPromptRequests("s2")).toBe(true);
  });

  it("#X6 the replay exit drains the collected set but NEVER the live registry", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "s1");

    // A genuinely pending prompt, re-sent by the bridge inside the window.
    register(bridge, "s1");
    await wait(60);
    promptRequest(bridge, "s1", "alive");
    replayComplete(bridge, "s1");
    await wait(150);
    await expectCurrentTool("s1", "ask_user");

    // A browser refreshing AFTER the exit must still be handed the dialog.
    // Draining the durable registry (rather than the ephemeral collected set)
    // would silently destroy this cache and the user would lose the prompt.
    // (The subscribe-time replay runs off the event-store path, so the session
    // needs at least one stored event; `message_start` is not extracted and so
    // cannot itself perturb `currentTool`.)
    fwd(bridge, "s1", "message_start");
    await wait(80);
    const { messages } = await connectBrowser("s1");
    await waitFor(() =>
      messages.some((m) => m.type === "prompt_request" && m.promptId === "alive"),
    );

    // A second replay cycle that re-sends it again must remain stable.
    register(bridge, "s1");
    await wait(60);
    promptRequest(bridge, "s1", "alive");
    replayComplete(bridge, "s1");
    await wait(150);
    await expectCurrentTool("s1", "ask_user");
  });

  it("#X3 the 5s safety timeout also reconciles when replay_complete never arrives", async () => {
    await boot();
    const bridge = await openBridge();
    await registerLive(bridge, "s1");
    promptRequest(bridge, "s1", "lost");
    await wait(120);
    await expectCurrentTool("s1", "ask_user");

    // Re-register and never send replay_complete.
    register(bridge, "s1");
    await wait(5400);
    await expectCurrentTool("s1", null);
  }, 20000);

  it("#X4/#X5 a late replay_complete after the timeout is a no-op and does not drop a live prompt", async () => {
    await boot();
    const bridge = await openBridge();
    const { messages } = await connectBrowser("s1");
    await registerLive(bridge, "s1");

    register(bridge, "s1");
    // Let the 5s safety timeout fire — this is the FIRST (and only acting) exit.
    await wait(5400);
    messages.length = 0;

    // A genuinely live prompt arrives after the window closed.
    promptRequest(bridge, "s1", "live");
    await wait(120);
    await expectCurrentTool("s1", "ask_user");

    // The late replay_complete must not reconcile against the closed set.
    replayComplete(bridge, "s1");
    await wait(200);
    await expectCurrentTool("s1", "ask_user");
    // …and must not re-send a duplicate event_replay.
    expect(messages.filter((m) => m.type === "event_replay")).toHaveLength(0);
  }, 20000);
});
