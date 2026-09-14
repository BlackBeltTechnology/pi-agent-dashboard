/**
 * Integration: deferred order-key re-resolution (change:
 * fix-worktree-spawn-placeholder-and-ordering, Defect B).
 *
 * A worktree session registers BEFORE the bridge sends `gitWorktree`, so its
 * id lands under the raw worktree-cwd order key. When `git_info_update` later
 * sets `gitWorktree.mainPath` (the parent repo), the server must re-key the id
 * to the FRONT of the parent key, prune the stale worktree-cwd key, and
 * broadcast a single `sessions_reordered { cwd: parent }`.
 *
 * Legacy bridges that send `gitWorktree` on the initial register resolve to
 * the parent key immediately, so the later re-assert is a no-op (no mutation,
 * no broadcast).
 */
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer, type ServerConfig } from "../server.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 2000, intervalMs = 20): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("waitFor: condition not met within timeout");
    await wait(intervalMs);
  }
}

async function connectSession(
  piPort: number,
  sessionId: string,
  cwd: string,
  registerExtra: Record<string, unknown> = {},
): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
  await new Promise<void>((resolve) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "session_register", sessionId, cwd, source: "cli", ...registerExtra }));
      ws.send(JSON.stringify({ type: "replay_complete", sessionId }));
      setTimeout(resolve, 50);
    });
  });
  return ws;
}

async function connectBrowser(browserPort: number): Promise<{ ws: WebSocket; reorders: any[]; updates: any[] }> {
  const reorders: any[] = [];
  const updates: any[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${browserPort}/ws`);
  ws.on("message", (raw) => {
    try {
      const m = JSON.parse(String(raw));
      if (m.type === "sessions_reordered") reorders.push(m);
      if (m.type === "session_updated") updates.push(m);
    } catch { /* ignore */ }
  });
  await new Promise<void>((resolve) => ws.on("open", () => setTimeout(resolve, 50)));
  return { ws, reorders, updates };
}

function sendGitInfo(
  ws: WebSocket,
  sessionId: string,
  gitWorktree: unknown,
  extra: Record<string, unknown> = {},
) {
  ws.send(JSON.stringify({ type: "git_info_update", sessionId, gitWorktree, ...extra }));
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

describe("event-wiring: deferred worktree order-key re-resolution", () => {
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

  it("re-keys a fresh worktree session to the FRONT of the parent key when gitWorktree arrives", async () => {
    await boot();
    const PARENT = "/repo";
    const WORKTREE = "/repo/.worktrees/feat-x";

    // A sibling already lives under the parent key.
    const sParent = await connectSession(piPort, "s-parent", PARENT);
    sockets.push(sParent);

    // Worktree session registers with NO gitWorktree → id lands under raw cwd key.
    const sWt = await connectSession(piPort, "s-wt", WORKTREE);
    sockets.push(sWt);

    const orderMgr = server.sessionOrderManager;
    expect(orderMgr.getOrder(WORKTREE)).toEqual(["s-wt"]);
    expect(orderMgr.getOrder(PARENT)).toEqual(["s-parent"]);

    const { ws: browser, reorders } = await connectBrowser(browserPort);
    sockets.push(browser);

    // git_info_update establishes the parent mainPath.
    sendGitInfo(sWt, "s-wt", { mainPath: PARENT, name: "feat-x" });

    await waitFor(() => orderMgr.getOrder(PARENT)[0] === "s-wt");
    // The order mutation is synchronous, but `sessions_reordered` arrives over
    // the socket; poll for delivery rather than reading `reorders` immediately.
    // See change: contention-harden-real-process-tests.
    await waitFor(() => reorders.some((r) => r.cwd === PARENT), 10_000);

    // Id moved to FRONT of parent; stale key pruned.
    expect(orderMgr.getOrder(PARENT)).toEqual(["s-wt", "s-parent"]);
    expect(orderMgr.getAllOrders()).not.toHaveProperty(WORKTREE);

    // Exactly one sessions_reordered for the parent transition.
    const parentReorders = reorders.filter((r) => r.cwd === PARENT);
    expect(parentReorders).toHaveLength(1);
    expect(parentReorders[0].sessionIds[0]).toBe("s-wt");
  });

  it("idempotent: a repeated git_info_update after re-key is a no-op (no extra broadcast)", async () => {
    // `gitWorktree` never arrives on the initial `session_register` (the
    // protocol message has no such field); it always comes via
    // `git_info_update`. So the "key already correct" guard is exercised by a
    // SECOND identical update after the first one already re-keyed the id.
    await boot();
    const PARENT = "/repo2";
    const WORKTREE = "/repo2/.worktrees/feat-y";

    const sWt = await connectSession(piPort, "s-wt2", WORKTREE);
    sockets.push(sWt);

    const orderMgr = server.sessionOrderManager;
    const { ws: browser, reorders } = await connectBrowser(browserPort);
    sockets.push(browser);

    // First update → re-key to parent (one broadcast).
    sendGitInfo(sWt, "s-wt2", { mainPath: PARENT, name: "feat-y" });
    await waitFor(() => orderMgr.getOrder(PARENT)[0] === "s-wt2");
    await waitFor(() => reorders.some((r) => r.cwd === PARENT), 10_000);
    expect(reorders.filter((r) => r.cwd === PARENT)).toHaveLength(1);

    // Second identical update → resolved key === current key → no-op.
    sendGitInfo(sWt, "s-wt2", { mainPath: PARENT, name: "feat-y" });
    await wait(300);

    expect(orderMgr.getOrder(PARENT)).toEqual(["s-wt2"]);
    expect(orderMgr.getAllOrders()).not.toHaveProperty(WORKTREE);
    // Still exactly one parent broadcast — the second update added none.
    expect(reorders.filter((r) => r.cwd === PARENT)).toHaveLength(1);
  });

  it("keeps parentage when the bridge clears after it was set (E5)", async () => {
    await boot();
    const PARENT = "/repo";
    const WORKTREE = "/repo/.worktrees/feat-x";
    const prior = { mainPath: PARENT, name: "feat-x" };

    const ws = await connectSession(piPort, "s-wt-e5", WORKTREE);
    sockets.push(ws);

    const { ws: browser, updates } = await connectBrowser(browserPort);
    sockets.push(browser);

    // Establish parentage via a first git_info_update.
    sendGitInfo(ws, "s-wt-e5", prior);
    await waitFor(() => server.sessionManager.get("s-wt-e5")?.gitWorktree?.mainPath === PARENT);
    const seenBefore = updates.length;

    // The bridge now clears (worktree removed underneath) while the session
    // stays alive — parentage MUST NOT be dropped.
    sendGitInfo(ws, "s-wt-e5", null, { gitBranch: "x" });
    await waitFor(() => updates.length > seenBefore);

    expect(server.sessionManager.get("s-wt-e5")?.gitWorktree).toEqual(prior);
    expect(server.sessionManager.get("s-wt-e5")?.gitWorktreeReported).toBe(true);
    const clearUpdate = updates[updates.length - 1];
    expect(clearUpdate.sessionId).toBe("s-wt-e5");
    expect(clearUpdate.updates.gitWorktree).toEqual(prior);
  });

  it("still clears on null when no parentage was set (E6)", async () => {
    await boot();
    const ws = await connectSession(piPort, "s-plain-e6", "/repo");
    sockets.push(ws);

    const { ws: browser, updates } = await connectBrowser(browserPort);
    sockets.push(browser);

    sendGitInfo(ws, "s-plain-e6", null);
    await waitFor(() => updates.some((u) => u.sessionId === "s-plain-e6"));

    expect(server.sessionManager.get("s-plain-e6")?.gitWorktree).toBeUndefined();
    expect(server.sessionManager.get("s-plain-e6")?.gitWorktreeReported).toBe(true);
  });

  it("reattach keeps parentage across a re-register + clear (E9)", async () => {
    await boot();
    const PARENT = "/repo";
    const WORKTREE = "/repo/.worktrees/feat-e9";
    const prior = { mainPath: PARENT, name: "feat-e9" };

    const ws = await connectSession(piPort, "s-wt-e9", WORKTREE);
    sockets.push(ws);

    // Establish parentage via the initial handshake update.
    sendGitInfo(ws, "s-wt-e9", prior);
    await waitFor(() => server.sessionManager.get("s-wt-e9")?.gitWorktree?.mainPath === PARENT);

    // Bridge reconnects: re-register the SAME cwd. `register()` must carry
    // parentage over (D2b) — otherwise the guard has no prior to protect.
    ws.send(JSON.stringify({
      type: "session_register", sessionId: "s-wt-e9", cwd: WORKTREE, source: "cli", registerReason: "reattach",
    }));
    ws.send(JSON.stringify({ type: "replay_complete", sessionId: "s-wt-e9" }));
    await waitFor(() => server.sessionManager.get("s-wt-e9")?.status === "active");
    expect(server.sessionManager.get("s-wt-e9")?.gitWorktree).toEqual(prior);

    // The reconnect cache reset forces a fresh `null` re-send; still ignored.
    sendGitInfo(ws, "s-wt-e9", null);
    await wait(200);
    expect(server.sessionManager.get("s-wt-e9")?.gitWorktree).toEqual(prior);
  });
});
