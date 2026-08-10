/**
 * Integration: server replays the in-memory `attachedProposal` to a
 * (re)registering bridge via `attach_proposal_changed` — the change name when
 * attached, else an explicit null to clear stale bridge state. Mirrors the
 * dashboard-restart reattach case. See change: inject-session-context-into-agent.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";

function registerOnce(ws: WebSocket, sessionId: string): void {
  ws.send(JSON.stringify({ type: "session_register", sessionId, cwd: "/tmp/replay", source: "cli" }));
  ws.send(JSON.stringify({ type: "replay_complete", sessionId }));
}

/** Resolve with the first `attach_proposal_changed` for `sessionId`, or null on timeout. */
function nextAttachPush(
  received: any[],
  sessionId: string,
  timeoutMs = 5_000,
): Promise<any | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const hit = received.find(
        (m) => m.type === "attach_proposal_changed" && m.sessionId === sessionId,
      );
      if (hit) return resolve(hit);
      if (Date.now() > deadline) return resolve(null);
      setTimeout(tick, 20);
    };
    tick();
  });
}

async function openBridge(piPort: number, sessionId: string): Promise<{ ws: WebSocket; received: any[] }> {
  const received: any[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
  ws.on("message", (buf) => {
    try { received.push(JSON.parse(buf.toString())); } catch { /* ignore */ }
  });
  await new Promise<void>((resolve) => {
    ws.on("open", () => { registerOnce(ws, sessionId); resolve(); });
  });
  // Drain the FIRST register's replay (scheduled via import(...).then(...), so
  // it can land late). Without this, a delayed initial push could be mistaken
  // for the second register's replay and make assertions flaky.
  await nextAttachPush(received, sessionId);
  received.length = 0;
  return { ws, received };
}

describe("attach_proposal replay on session_register", () => {
  let server: DashboardServer;
  let piPort: number;

  beforeEach(async () => {
    server = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true,
      autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
    });
    await server.start();
    piPort = server.piPort()!;
  });

  afterEach(async () => { await server.stop(); });

  it("replays current attachedProposal to a reattaching bridge", async () => {
    const { ws, received } = await openBridge(piPort, "s1");
    // Simulate state surviving in memory (as after a dashboard restart).
    server.sessionManager.update("s1", { attachedProposal: "X" });
    received.length = 0;

    // Reattach: a fresh session_register for the same sessionId (no pending intent).
    registerOnce(ws, "s1");
    const push = await nextAttachPush(received, "s1");

    expect(push).toEqual({ type: "attach_proposal_changed", sessionId: "s1", attachedChange: "X" });
    ws.close();
  });

  it("replays null to clear stale bridge state when no proposal is attached", async () => {
    const { ws, received } = await openBridge(piPort, "s2");
    received.length = 0;

    registerOnce(ws, "s2");
    const push = await nextAttachPush(received, "s2");

    expect(push).toEqual({ type: "attach_proposal_changed", sessionId: "s2", attachedChange: null });
    ws.close();
  });
});
