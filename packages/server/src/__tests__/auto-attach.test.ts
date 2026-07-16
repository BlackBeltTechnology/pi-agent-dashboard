import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";

/**
 * Helper: connect a pi session via WebSocket and register it.
 */
async function connectSession(piPort: number, sessionId: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
  await new Promise<void>((resolve) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "session_register",
        sessionId,
        cwd: "/tmp",
        source: "cli",
      }));
      // Without replay_complete, event-wiring treats incoming events as replay
      // and suppresses auto-attach. Send it immediately so subsequent events run
      // through the normal live path.
      ws.send(JSON.stringify({
        type: "replay_complete",
        sessionId,
      }));
      setTimeout(resolve, 50);
    });
  });
  return ws;
}

/**
 * Helper: send a tool_execution_start event that triggers OpenSpec detection.
 * Uses a Read tool on a SKILL.md path to trigger phase detection,
 * or a Read/Write on an openspec/changes/ path for changeName detection.
 */
function sendToolEvent(ws: WebSocket, sessionId: string, opts: { phase?: string; changeName?: string }) {
  if (opts.phase) {
    // Map phase back to skill name suffix for detection
    const phaseToSuffix: Record<string, string> = {
      apply: "apply-change",
      archive: "archive-change",
      continue: "continue-change",
      explore: "explore",
      ff: "ff-change",
      new: "new-change",
      verify: "verify-change",
    };
    const suffix = phaseToSuffix[opts.phase] ?? opts.phase;
    ws.send(JSON.stringify({
      type: "event_forward",
      sessionId,
      event: {
        eventType: "tool_execution_start",
        timestamp: Date.now(),
        data: {
          toolName: "Read",
          args: { path: `.pi/skills/openspec-${suffix}/SKILL.md` },
        },
      },
    }));
  }
  if (opts.changeName) {
    // Use Write (active) so auto-attach fires — Read is passive and only sets openspecChange,
    // not attachedProposal (see event-wiring.ts: attach requires detected.isActive).
    ws.send(JSON.stringify({
      type: "event_forward",
      sessionId,
      event: {
        eventType: "tool_execution_start",
        timestamp: Date.now(),
        data: {
          toolName: "Write",
          args: { path: `openspec/changes/${opts.changeName}/proposal.md` },
        },
      },
    }));
  }
}

/**
 * Helper: send a detach_proposal via browser gateway.
 */
async function sendDetach(browserPort: number, sessionId: string): Promise<void> {
  const ws = new WebSocket(`ws://127.0.0.1:${browserPort}/ws`);
  await new Promise<void>((resolve) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "detach_proposal",
        sessionId,
      }));
      setTimeout(resolve, 50);
    });
  });
  ws.close();
}

describe("Auto-attach from openspec activity", () => {
  let server: DashboardServer;
  let piPort: number;
  let browserPort: number;
  let ws: WebSocket;

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
    ws = await connectSession(piPort, "s1");
  });

  afterEach(async () => {
    ws.close();
    await server.stop();
  });

  it("auto-attaches when phase and changeName arrive in separate events", async () => {
    // Send phase only (via skill file read)
    sendToolEvent(ws, "s1", { phase: "apply" });
    await new Promise((r) => setTimeout(r, 80));

    let session = server.sessionManager.get("s1");
    expect(session?.attachedProposal).toBeFalsy();

    // Send changeName only (via change file read)
    sendToolEvent(ws, "s1", { changeName: "add-auth" });
    await new Promise((r) => setTimeout(r, 80));

    session = server.sessionManager.get("s1");
    expect(session?.attachedProposal).toBe("add-auth");
  });

  it("auto-attaches when only changeName is detected (no phase)", async () => {
    // Only send changeName — no phase event at all
    // This happens when a skill is loaded via prompt template (no SKILL.md read tool event)
    sendToolEvent(ws, "s1", { changeName: "my-feature" });
    await new Promise((r) => setTimeout(r, 80));

    const session = server.sessionManager.get("s1");
    expect(session?.attachedProposal).toBe("my-feature");
  });

  it("auto-attaches when both arrive from a single tool event", async () => {
    // A single tool event can only detect one thing at a time (phase OR changeName),
    // so we send two events in quick succession
    sendToolEvent(ws, "s1", { phase: "apply" });
    sendToolEvent(ws, "s1", { changeName: "add-auth" });
    await new Promise((r) => setTimeout(r, 80));

    const session = server.sessionManager.get("s1");
    expect(session?.attachedProposal).toBe("add-auth");
  });

  it("auto-names session from changeName when name is blank", async () => {
    sendToolEvent(ws, "s1", { changeName: "cool-feature" });
    await new Promise((r) => setTimeout(r, 80));

    const session = server.sessionManager.get("s1");
    expect(session?.attachedProposal).toBe("cool-feature");
    expect(session?.name).toBe("cool-feature");
  });

  // Auto-detect re-attach (witness rule). See change: fix-mobile-attach-proposal-display
  // (design.md §"Auto-detect parallel path"). The previous behavior
  // (`!updatedSession.attachedProposal` guard) had the one-shot pathology this
  // change fixes: an auto-tracked attachment could not be replaced even when a
  // different changeName was detected.

  it("§2A.2[1] fresh session — auto-attaches and auto-names", async () => {
    sendToolEvent(ws, "s1", { changeName: "bar" });
    await new Promise((r) => setTimeout(r, 80));
    const s = server.sessionManager.get("s1");
    expect(s?.attachedProposal).toBe("bar");
    expect(s?.name).toBe("bar");
  });

  it("§2A.2[2] auto-tracked session re-attaches when a different changeName is detected", async () => {
    sendToolEvent(ws, "s1", { changeName: "foo" });
    await new Promise((r) => setTimeout(r, 80));
    let s = server.sessionManager.get("s1");
    expect(s?.attachedProposal).toBe("foo");
    expect(s?.name).toBe("foo");

    // Different changeName via active tool — witness arm should re-attach.
    sendToolEvent(ws, "s1", { changeName: "bar" });
    await new Promise((r) => setTimeout(r, 80));
    s = server.sessionManager.get("s1");
    expect(s?.attachedProposal).toBe("bar");
    expect(s?.name).toBe("bar");
    expect(s?.openspecChange).toBe("bar");
  });

  it("§2A.2[3] custom-named session — openspecChange tracks reality, attached/name preserved", async () => {
    // Set custom name + auto-attach foo via earlier activity
    server.sessionManager.update("s1", { name: "my custom" } as any);
    sendToolEvent(ws, "s1", { changeName: "foo" });
    await new Promise((r) => setTimeout(r, 80));
    let s = server.sessionManager.get("s1");
    // attach happens (attachmentWasAutoTracked: attached=null counts as auto)
    // BUT name stays "my custom" because attachRenameTarget returns undefined
    // when name is custom and attached is null.
    expect(s?.attachedProposal).toBe("foo");
    expect(s?.name).toBe("my custom");

    // Different changeName detected. attachmentWasAutoTracked = false because
    // name ("my custom") !== attachedProposal ("foo"). So attached + name MUST
    // NOT change. openspecChange SHOULD update via the activity-detector branch.
    sendToolEvent(ws, "s1", { changeName: "bar" });
    await new Promise((r) => setTimeout(r, 80));
    s = server.sessionManager.get("s1");
    expect(s?.attachedProposal).toBe("foo");
    expect(s?.name).toBe("my custom");
    expect(s?.openspecChange).toBe("bar");
  });

  it("§2A.2[4] already-converged state — no rename, no re-broadcast of redundant name", async () => {
    sendToolEvent(ws, "s1", { changeName: "bar" });
    await new Promise((r) => setTimeout(r, 80));
    const before = server.sessionManager.get("s1");
    expect(before?.attachedProposal).toBe("bar");

    // Same changeName again — differentChangeDetected is false; no rename fires.
    sendToolEvent(ws, "s1", { changeName: "bar" });
    await new Promise((r) => setTimeout(r, 80));
    const after = server.sessionManager.get("s1");
    expect(after?.attachedProposal).toBe("bar");
    expect(after?.name).toBe("bar");
  });
});

describe("Detach clears openspec state", () => {
  let server: DashboardServer;
  let piPort: number;
  let browserPort: number;
  let ws: WebSocket;

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
    ws = await connectSession(piPort, "s1");
  });

  afterEach(async () => {
    ws.close();
    await server.stop();
  });

  it("clears openspecPhase and openspecChange on detach", async () => {
    // Attach first
    sendToolEvent(ws, "s1", { phase: "apply" });
    sendToolEvent(ws, "s1", { changeName: "add-auth" });
    await new Promise((r) => setTimeout(r, 80));

    let session = server.sessionManager.get("s1");
    expect(session?.attachedProposal).toBe("add-auth");

    // Detach via browser
    await sendDetach(browserPort, "s1");
    await new Promise((r) => setTimeout(r, 80));

    session = server.sessionManager.get("s1");
    expect(session?.attachedProposal).toBeNull();
    expect(session?.openspecPhase).toBeNull();
    expect(session?.openspecChange).toBeNull();
  });

  it("allows re-attach after detach with new activity", async () => {
    // Attach
    sendToolEvent(ws, "s1", { phase: "apply" });
    sendToolEvent(ws, "s1", { changeName: "add-auth" });
    await new Promise((r) => setTimeout(r, 80));

    // Detach
    await sendDetach(browserPort, "s1");
    await new Promise((r) => setTimeout(r, 80));

    // New activity
    sendToolEvent(ws, "s1", { phase: "ff" });
    sendToolEvent(ws, "s1", { changeName: "new-change" });
    await new Promise((r) => setTimeout(r, 80));

    const session = server.sessionManager.get("s1");
    expect(session?.attachedProposal).toBe("new-change");
  });
});
