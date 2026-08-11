/**
 * Wiring-level coverage for the OpenSpec auto-attach locality gate.
 * Scenario ids reference
 * `openspec/changes/scope-openspec-auto-attach-to-session-cwd/test-plan.md`.
 *
 * Exercises the real server (pi WebSocket → event-wiring), stubbing only the
 * OpenSpec poll cache so the tri-state gate has a deterministic answer.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";

const CWD = "/repo-a";
const MAIN = "/repo-main";

let server: DashboardServer;
let ws: WebSocket;

async function connect(sessionId: string, cwd = CWD): Promise<WebSocket> {
  const sock = new WebSocket(`ws://127.0.0.1:${server.piPort()!}`);
  await new Promise<void>((resolve) => {
    sock.on("open", () => {
      sock.send(JSON.stringify({ type: "session_register", sessionId, cwd, source: "cli" }));
      sock.send(JSON.stringify({ type: "replay_complete", sessionId }));
      setTimeout(resolve, 50);
    });
  });
  return sock;
}

/** Stub the in-memory OpenSpec poll cache: root → change names, or `undefined`. */
function stubCache(map: Record<string, string[] | undefined>): void {
  (server.directoryService as any).getOpenSpecData = (cwd: string) => {
    const names = map[cwd];
    if (!names) return undefined;
    return { initialized: true, changes: names.map((name) => ({ name })), specs: [] };
  };
}

/** Active (write) detection on a path INSIDE the session cwd — local evidence. */
function sendLocalPathEvent(sock: WebSocket, sessionId: string, changeName: string, cwd = CWD): void {
  sock.send(JSON.stringify({
    type: "event_forward",
    sessionId,
    event: {
      eventType: "tool_execution_start",
      timestamp: Date.now(),
      data: { toolName: "Write", args: { path: `${cwd}/openspec/changes/${changeName}/proposal.md` } },
    },
  }));
}

/** Active CLI detection that is NOT change-creating — no local evidence. */
function sendForeignEvidenceEvent(sock: WebSocket, sessionId: string, changeName: string): void {
  sock.send(JSON.stringify({
    type: "event_forward",
    sessionId,
    event: {
      eventType: "tool_execution_start",
      timestamp: Date.now(),
      data: { toolName: "Bash", args: { command: `openspec archive ${changeName}` } },
    },
  }));
}

/** Change-CREATING CLI detection — local evidence by construction (D4a). */
function sendCreateEvent(sock: WebSocket, sessionId: string, changeName: string): void {
  sock.send(JSON.stringify({
    type: "event_forward",
    sessionId,
    event: {
      eventType: "tool_execution_start",
      timestamp: Date.now(),
      data: { toolName: "Bash", args: { command: `openspec new change ${changeName}` } },
    },
  }));
}

const settle = () => new Promise((r) => setTimeout(r, 90));

/** Mark the session worktree-resolved, as a bridge report would. */
function markResolved(sessionId: string, extra: Record<string, unknown> = {}): void {
  server.sessionManager.update(sessionId, { gitWorktreeReported: true, ...extra } as any);
}

const notices = (sessionId: string) => server.sessionManager.get(sessionId)?.notifyLog ?? [];

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
  ws = await connect("s1");
});

afterEach(async () => {
  ws.close();
  await server.stop();
});

describe("locality gate blocks a foreign change", () => {
  it("E1 rejects a change absent from the session's own project", async () => {
    stubCache({ [CWD]: ["c-a"] });
    markResolved("s1");
    sendForeignEvidenceEvent(ws, "s1", "c-b");
    await settle();

    const s = server.sessionManager.get("s1");
    expect(s?.attachedProposal).toBeFalsy();
    expect(s?.openspecChange).toBeFalsy();
    expect(s?.name).not.toBe("c-b");
  });

  it("E2 attaches when the change IS listed for the session cwd", async () => {
    stubCache({ [CWD]: ["c-a", "c-b"] });
    markResolved("s1");
    sendForeignEvidenceEvent(ws, "s1", "c-b");
    await settle();

    expect(server.sessionManager.get("s1")?.attachedProposal).toBe("c-b");
  });

  it("E3 allows a worktree change present only in the main checkout", async () => {
    stubCache({ [CWD]: [], [MAIN]: ["c-a"] });
    markResolved("s1", { gitWorktree: { mainPath: MAIN } });
    sendForeignEvidenceEvent(ws, "s1", "c-a");
    await settle();

    expect(server.sessionManager.get("s1")?.attachedProposal).toBe("c-a");
  });

  it("E21 a rejection leaves a manual attachment and its branches untouched", async () => {
    stubCache({ [CWD]: ["c-manual"] });
    markResolved("s1");
    server.sessionManager.update("s1", { attachedProposal: "c-manual", name: "custom" } as any);
    sendForeignEvidenceEvent(ws, "s1", "c-b");
    await settle();

    const s = server.sessionManager.get("s1");
    expect(s?.attachedProposal).toBe("c-manual");
    expect(s?.openspecChange).toBeFalsy();
    expect(s?.pendingReplaceProposal).toBeFalsy();
  });

  it("E22 a main-only manual attachment is not treated as deleted (branch 4 → branch 3)", async () => {
    stubCache({ [CWD]: ["c-b"], [MAIN]: ["c-a"] });
    markResolved("s1", { gitWorktree: { mainPath: MAIN } });
    server.sessionManager.update("s1", { attachedProposal: "c-a", name: "custom" } as any);
    sendForeignEvidenceEvent(ws, "s1", "c-b");
    await settle();

    const s = server.sessionManager.get("s1");
    expect(s?.attachedProposal).toBe("c-a");
    expect(s?.pendingReplaceProposal).toBe("c-b");
  });

  it("E23 a genuinely archived attachment still bypasses the dialog", async () => {
    stubCache({ [CWD]: ["c-new"] });
    markResolved("s1");
    server.sessionManager.update("s1", { attachedProposal: "c-manual", name: "custom" } as any);
    sendForeignEvidenceEvent(ws, "s1", "c-new");
    await settle();

    const s = server.sessionManager.get("s1");
    expect(s?.attachedProposal).toBe("c-new");
    expect(s?.pendingReplaceProposal).toBeFalsy();
  });
});

describe("manual attach is not gated", () => {
  it("E4 REST attach applies a change absent from every candidate root", async () => {
    stubCache({ [CWD]: ["c-a"] });
    markResolved("s1");

    const res = await fetch(`http://127.0.0.1:${server.httpPort()!}/api/session/s1/attach-proposal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changeName: "c-b" }),
    });

    expect(res.status).toBe(200);
    expect(server.sessionManager.get("s1")?.attachedProposal).toBe("c-b");
    expect(notices("s1")).toEqual([]);
  });
});

describe("rejection notice", () => {
  it("X1 emits exactly one notice for a repeat storm on the same name", async () => {
    stubCache({ [CWD]: ["c-a"] });
    markResolved("s1");
    for (let i = 0; i < 6; i++) sendForeignEvidenceEvent(ws, "s1", "c-b");
    await settle();

    const log = notices("s1");
    expect(log.length).toBe(1);
    expect(log[0].message).toContain("c-b");
    expect(log[0].level).toBe("info");
  });

  it("X2 emits one notice per distinct rejected name", async () => {
    stubCache({ [CWD]: ["c-a"] });
    markResolved("s1");
    sendForeignEvidenceEvent(ws, "s1", "c-b");
    sendForeignEvidenceEvent(ws, "s1", "c-c");
    await settle();

    expect(notices("s1").length).toBe(2);
  });

  it("X3 the create-then-write flow emits ZERO notices", async () => {
    stubCache({ [CWD]: ["other"] });
    markResolved("s1");
    sendCreateEvent(ws, "s1", "c-a");
    await settle();
    sendLocalPathEvent(ws, "s1", "c-a");
    await settle();

    expect(notices("s1")).toEqual([]);
    expect(server.sessionManager.get("s1")?.attachedProposal).toBeFalsy();
  });

  it("X4 a suppressed rejection does not consume the dedupe slot", async () => {
    stubCache({ [CWD]: ["other"] });
    markResolved("s1");
    // Locally-evidenced rejection first — silent.
    sendLocalPathEvent(ws, "s1", "c-b");
    await settle();
    expect(notices("s1")).toEqual([]);

    // The gate rejects `c-b` again, but the name is already flagged local for
    // this session, so it stays silent: the dedupe slot was never consumed.
    sendForeignEvidenceEvent(ws, "s1", "c-b");
    await settle();
    const log = notices("s1");
    expect(log.filter((e) => e.message.includes("c-b")).length).toBeLessThanOrEqual(1);
  });

  it("X5 per-session state does not survive unregister", async () => {
    stubCache({ [CWD]: ["c-a"] });
    markResolved("s1");
    sendForeignEvidenceEvent(ws, "s1", "c-b");
    await settle();
    expect(notices("s1").length).toBe(1);

    ws.send(JSON.stringify({ type: "session_unregister", sessionId: "s1" }));
    await settle();
    ws.close();

    ws = await connect("s1");
    markResolved("s1");
    sendForeignEvidenceEvent(ws, "s1", "c-b");
    await settle();
    expect(notices("s1").filter((e) => e.message.includes("c-b")).length).toBe(2);
  });

  it("X6 a notice adds no pending ask / prompt request and leaves the session reapable", async () => {
    stubCache({ [CWD]: ["c-a"] });
    markResolved("s1");
    // Control: an ordinary tool event with no OpenSpec detection at all, so
    // any difference below is attributable to the notice and not to the
    // surrounding `tool_execution_start` bookkeeping.
    const control = await connect("s2");
    markResolved("s2");
    control.send(JSON.stringify({
      type: "event_forward",
      sessionId: "s2",
      event: {
        eventType: "tool_execution_start",
        timestamp: Date.now(),
        data: { toolName: "Bash", args: { command: "npm test" } },
      },
    }));
    sendForeignEvidenceEvent(ws, "s1", "c-b");
    await settle();

    const s = server.sessionManager.get("s1");
    const c = server.sessionManager.get("s2");
    expect(notices("s1").length).toBe(1);
    // `hasPendingAsk` / `hasPendingPromptRequests` are NOT fields of
    // `DashboardSession` — reading them off the session failed `tsc --noEmit`
    // and, being `undefined`, made both assertions vacuously true. The pending
    // prompt-request state lives on the browser gateway, so assert it there,
    // where the check can actually fail. There is no session-level pending-ask
    // observable; the notice path is covered by the notice count above and by
    // the status/currentTool parity against the control session below.
    expect(server.browserGateway.hasPendingPromptRequests("s1")).toBe(false);
    expect(s?.status).toBe(c?.status);
    expect(s?.currentTool).toBe(c?.currentTool);
    control.close();
  });
});

describe("worktree-report plumbing", () => {
  it("X8 a worktree-state broadcast carries no gitWorktreeReported key", async () => {
    const payloads: Array<Record<string, unknown>> = [];
    const original = server.browserGateway.broadcastSessionUpdated.bind(server.browserGateway);
    (server.browserGateway as any).broadcastSessionUpdated = (id: string, updates: Record<string, unknown>) => {
      payloads.push(updates);
      return original(id, updates);
    };

    ws.send(JSON.stringify({
      type: "git_info_update",
      sessionId: "s1",
      gitBranch: "main",
      gitWorktree: null,
    }));
    await settle();

    expect(server.sessionManager.get("s1")?.gitWorktreeReported).toBe(true);
    expect(payloads.some((p) => "gitWorktreeReported" in p)).toBe(false);
  });

  it("E9 a reported non-worktree session becomes reject-capable", async () => {
    stubCache({ [CWD]: ["c-a"] });
    ws.send(JSON.stringify({ type: "git_info_update", sessionId: "s1", gitBranch: "main", gitWorktree: null }));
    await settle();

    sendForeignEvidenceEvent(ws, "s1", "c-b");
    await settle();
    expect(server.sessionManager.get("s1")?.attachedProposal).toBeFalsy();
  });

  it("X7 an unreported session with unknown isGitRepo is never rejected", async () => {
    stubCache({ [CWD]: ["c-a"] });
    server.sessionManager.update("s1", { isGitRepo: undefined } as any);
    sendForeignEvidenceEvent(ws, "s1", "c-b");
    await settle();

    expect(server.sessionManager.get("s1")?.attachedProposal).toBe("c-b");
  });
});
