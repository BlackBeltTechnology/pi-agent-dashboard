import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";

/**
 * Integration tests for the replace-proposal race-handling change.
 * See change: replace-proposal-dialog-with-race-handling.
 *
 * Branch 3 (manual attachment → pendingReplaceProposal) requires the
 * attachment to be "manual" in the witness sense: name !== attachedProposal.
 * We seed that via sessionManager.update.
 */

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

/** Active Write event → detector emits changeName (isActive: true). */
function sendChangeEvent(ws: WebSocket, sessionId: string, changeName: string) {
  ws.send(JSON.stringify({
    type: "event_forward",
    sessionId,
    event: {
      eventType: "tool_execution_start",
      timestamp: Date.now(),
      data: { toolName: "Write", args: { path: `openspec/changes/${changeName}/proposal.md` } },
    },
  }));
}

/** Passive Read event → detector emits changeName with isActive: false. */
function sendReadEvent(ws: WebSocket, sessionId: string, changeName: string) {
  ws.send(JSON.stringify({
    type: "event_forward",
    sessionId,
    event: {
      eventType: "tool_execution_start",
      timestamp: Date.now(),
      data: { toolName: "Read", args: { path: `openspec/changes/${changeName}/proposal.md` } },
    },
  }));
}

function sendAgentEnd(ws: WebSocket, sessionId: string) {
  ws.send(JSON.stringify({
    type: "event_forward",
    sessionId,
    event: { eventType: "agent_end", timestamp: Date.now(), data: {} },
  }));
}

/** Open a browser ws, send one message, close. */
async function sendBrowser(browserPort: number, msg: unknown): Promise<void> {
  const ws = new WebSocket(`ws://127.0.0.1:${browserPort}/ws`);
  await new Promise<void>((resolve) => {
    ws.on("open", () => {
      ws.send(JSON.stringify(msg));
      setTimeout(() => { ws.close(); resolve(); }, 50);
    });
  });
}

/** Collect session_updated broadcasts for a session. */
function collectUpdates(browserPort: number): Promise<{ ws: WebSocket; updates: any[] }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${browserPort}/ws`);
    const updates: any[] = [];
    ws.on("message", (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        if (m.type === "session_updated") updates.push(m.updates);
      } catch { /* ignore */ }
    });
    ws.on("open", () => setTimeout(() => resolve({ ws, updates }), 30));
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("replace-proposal race handling", () => {
  let server: DashboardServer;
  let piPort: number;
  let browserPort: number;
  let ws: WebSocket;

  beforeEach(async () => {
    server = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true, autoShutdown: false,
      shutdownIdleSeconds: 999, tunnel: false,
    });
    await server.start();
    browserPort = server.httpPort()!;
    piPort = server.piPort()!;
    ws = await connectSession(piPort, "s1");
    // Manual attachment: name differs from attachedProposal so the witness
    // rule `isNameAutoSetFromAttachment` returns false.
    server.sessionManager.update("s1", { name: "custom name", attachedProposal: "change-a" } as any);
  });

  afterEach(async () => {
    ws.close();
    await server.stop();
  });

  it("4.1 manual attachment + new active changeName → pendingReplaceProposal set, broadcast emitted", async () => {
    const { ws: bws, updates } = await collectUpdates(browserPort);
    sendChangeEvent(ws, "s1", "change-b");
    await wait(100);
    const s = server.sessionManager.get("s1");
    expect(s?.pendingReplaceProposal).toBe("change-b");
    expect(s?.attachedProposal).toBe("change-a");
    expect(updates.some((u) => u.pendingReplaceProposal === "change-b")).toBe(true);
    bws.close();
  });

  it("4.2 same changeName fires twice → only one broadcast carries pendingReplaceProposal=B", async () => {
    const { ws: bws, updates } = await collectUpdates(browserPort);
    sendChangeEvent(ws, "s1", "change-b");
    await wait(80);
    sendChangeEvent(ws, "s1", "change-b");
    await wait(80);
    const count = updates.filter((u) => u.pendingReplaceProposal === "change-b").length;
    expect(count).toBe(1);
    bws.close();
  });

  it("4.3 changeName A then B (both new) → pendingReplaceProposal overwrites with two broadcasts", async () => {
    const { ws: bws, updates } = await collectUpdates(browserPort);
    sendChangeEvent(ws, "s1", "change-b");
    await wait(80);
    sendChangeEvent(ws, "s1", "change-c");
    await wait(80);
    const s = server.sessionManager.get("s1");
    expect(s?.pendingReplaceProposal).toBe("change-c");
    expect(updates.some((u) => u.pendingReplaceProposal === "change-b")).toBe(true);
    expect(updates.some((u) => u.pendingReplaceProposal === "change-c")).toBe(true);
    bws.close();
  });

  it("4.4 dismiss B → rejectedReplaceProposals contains B, subsequent B events no-op", async () => {
    sendChangeEvent(ws, "s1", "change-b");
    await wait(80);
    await sendBrowser(browserPort, { type: "dismiss_replace_proposal", sessionId: "s1", changeName: "change-b" });
    await wait(80);
    let s = server.sessionManager.get("s1");
    expect(s?.rejectedReplaceProposals).toContain("change-b");
    expect(s?.pendingReplaceProposal).toBeFalsy();
    // openspecChange already "change-b"; the same B event is a no-op (changed=false).
    sendChangeEvent(ws, "s1", "change-b");
    await wait(80);
    s = server.sessionManager.get("s1");
    expect(s?.pendingReplaceProposal).toBeFalsy();
  });

  it("4.5 dismiss B then C arrives → C surfaces as new pendingReplaceProposal", async () => {
    sendChangeEvent(ws, "s1", "change-b");
    await wait(80);
    await sendBrowser(browserPort, { type: "dismiss_replace_proposal", sessionId: "s1", changeName: "change-b" });
    await wait(80);
    sendChangeEvent(ws, "s1", "change-c");
    await wait(80);
    const s = server.sessionManager.get("s1");
    expect(s?.pendingReplaceProposal).toBe("change-c");
    expect(s?.rejectedReplaceProposals).toContain("change-b");
  });

  it("4.6 agent_end clears both pending and rejected; subsequent B re-prompts", async () => {
    sendChangeEvent(ws, "s1", "change-b");
    await wait(80);
    await sendBrowser(browserPort, { type: "dismiss_replace_proposal", sessionId: "s1", changeName: "change-b" });
    await wait(80);
    sendAgentEnd(ws, "s1");
    await wait(80);
    let s = server.sessionManager.get("s1");
    expect(s?.pendingReplaceProposal).toBeFalsy();
    expect(s?.rejectedReplaceProposals ?? []).toHaveLength(0);
    expect(s?.openspecChange).toBeFalsy();
    // New turn, B again → re-prompts (openspecChange was cleared so changed=true).
    sendChangeEvent(ws, "s1", "change-b");
    await wait(80);
    s = server.sessionManager.get("s1");
    expect(s?.pendingReplaceProposal).toBe("change-b");
  });

  it("4.7 accept_replace_proposal attaches the named change, runs auto-rename, clears pending", async () => {
    sendChangeEvent(ws, "s1", "change-b");
    await wait(80);
    expect(server.sessionManager.get("s1")?.pendingReplaceProposal).toBe("change-b");
    await sendBrowser(browserPort, { type: "accept_replace_proposal", sessionId: "s1", changeName: "change-b" });
    await wait(80);
    const s = server.sessionManager.get("s1");
    expect(s?.attachedProposal).toBe("change-b");
    expect(s?.pendingReplaceProposal).toBeFalsy();
    // name was custom ("custom name") → attachRenameTarget returns undefined,
    // so name is preserved (auto-rename only fires for blank/auto-tracked names).
    expect(s?.name).toBe("custom name");
  });

  it("4.8 accept_replace_proposal with a non-matching name is rejected (defensive)", async () => {
    sendChangeEvent(ws, "s1", "change-b");
    await wait(80);
    // "change-z" matches neither pendingReplaceProposal ("change-b") nor attachedProposal ("change-a").
    await sendBrowser(browserPort, { type: "accept_replace_proposal", sessionId: "s1", changeName: "change-z" });
    await wait(80);
    const s = server.sessionManager.get("s1");
    expect(s?.attachedProposal).toBe("change-a");
    expect(s?.pendingReplaceProposal).toBe("change-b");
  });

  it("4.9 deleted-proposal bypass → auto-attaches Y silently (no pendingReplaceProposal)", async () => {
    // attachedProposal "change-a" is NOT present in the poll cache → bypass.
    server.directoryService.getOpenSpecData = () =>
      ({ initialized: true, changes: [{ name: "other", status: "no-tasks", completedTasks: 0, totalTasks: 0, artifacts: [] }] }) as any;
    sendChangeEvent(ws, "s1", "change-y");
    await wait(100);
    const s = server.sessionManager.get("s1");
    expect(s?.attachedProposal).toBe("change-y");
    expect(s?.pendingReplaceProposal).toBeFalsy();
  });

  it("4.10 isActive=false (read) events never set pendingReplaceProposal", async () => {
    sendReadEvent(ws, "s1", "change-b");
    await wait(100);
    const s = server.sessionManager.get("s1");
    expect(s?.pendingReplaceProposal).toBeFalsy();
    expect(s?.attachedProposal).toBe("change-a");
  });
});
