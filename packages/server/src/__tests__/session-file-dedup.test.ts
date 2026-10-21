/**
 * Tests that when a new session registers with a sessionFile already used by
 * an ENDED session, the old session is superseded (evicted via
 * `session_archived`, never left as a fileless orphan). This prevents resuming
 * a stale session from loading the wrong conversation AND an un-archivable card.
 * See change: fix-orphaned-ended-session-archive.
 */
import { afterAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { DashboardServer } from "../server.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on("open", resolve);
    ws.on("error", reject);
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

function collectMsgs(ws: WebSocket, ms: number): Promise<any[]> {
  return new Promise((resolve) => {
    const arr: any[] = [];
    const h = (raw: any) => arr.push(JSON.parse(raw.toString()));
    ws.on("message", h);
    setTimeout(() => { ws.off("message", h); resolve(arr); }, ms);
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
let handle: TestServerHandle;
let server: DashboardServer;
let piPort: number;


describe("session file deduplication", () => {
  afterAll(async () => {
    if (handle) await handle.stop();
  });

  it("supersedes (evicts) the ended old session when a new session registers with the same file", async () => {
    handle = await createTestServer();
    server = handle.server;
    piPort = handle.piPort;
    const httpPort = handle.httpPort;

    const sharedFile = "/tmp/sessions/test.jsonl";

    // Bridge registers session A with a sessionFile
    const bridge = new WebSocket(`ws://localhost:${piPort}`);
    await waitForOpen(bridge);
    bridge.send(JSON.stringify({
      type: "session_register",
      sessionId: "session-a",
      cwd: "/tmp/project",
      source: "tui",
      name: "filesystem-browser",
      sessionFile: sharedFile,
    }));
    await delay(100);

    // Session A ends
    bridge.send(JSON.stringify({
      type: "session_unregister",
      sessionId: "session-a",
    }));
    await delay(100);

    // Browser connects to observe updates
    const browser = new WebSocket(`ws://localhost:${httpPort}/ws`);
    await waitForOpen(browser);
    const msgs = collectMsgs(browser, 500);
    await delay(50);

    // Bridge registers session B (continued from same file) with same sessionFile
    bridge.send(JSON.stringify({
      type: "session_register",
      sessionId: "session-b",
      cwd: "/tmp/project",
      source: "tui",
      name: "fix-concurrent-server-launch",
      sessionFile: sharedFile,
    }));

    const collected = await msgs;

    // The ended predecessor is evicted with a `session_archived` frame, not
    // left behind with a cleared sessionFile.
    const evicted = collected.find((m: any) => m.type === "session_archived" && m.sessionId === "session-a");
    expect(evicted).toBeDefined();
    const clearUpdate = collected.find(
      (m: any) => m.type === "session_updated" && m.sessionId === "session-a" && m.updates?.sessionFile === null,
    );
    expect(clearUpdate).toBeUndefined();
    expect(server.sessionManager.get("session-a")).toBeUndefined();

    // Session B should have the sessionFile
    const addedB = collected.find(
      (m: any) => m.type === "session_added" && m.session?.id === "session-b",
    );
    expect(addedB?.session?.sessionFile).toBe(sharedFile);

    bridge.close();
    browser.close();
    await delay(50);
  });
});
