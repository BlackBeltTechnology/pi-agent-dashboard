/**
 * Regression test: when a new session registers for a cwd that has a
 * pending auto-resume, `resuming: false` must be set on the OLD session
 * (pendingResume.oldSessionId), not the newly-registered one.
 *
 * Root cause: the original code used `sessionId` (new session) instead
 * of `pendingResume.oldSessionId`, making the update a no-op on the new
 * session and leaving the old session permanently stuck at `resuming: true`.
 * `consume()` also cancels the 30s timeout, so `onTimeout` never fired.
 *
 * See change: fix-electron-server-launch-node-bin (resume stuck bug).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createServer, type DashboardServer } from "../server.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("event-wiring: pending-resume clears old session resuming flag", () => {
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

  it("clears resuming on oldSessionId (not newSessionId) when resumed session registers", async () => {
    const { sessionManager, browserGateway } = server;

    const OLD_SESSION = "old-session-aaa";
    const NEW_SESSION = "new-session-bbb";
    // Use a real temp dir so meta-persistence doesn't fail on mkdir.
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-resume-test-"));
    const CWD = tmpDir;
    const sessionFile = path.join(tmpDir, "old.jsonl");
    writeFileSync(sessionFile, ""); // create empty file

    // 1. Seed the old session as ended with resuming:true.
    //    register() sets status:"active", so follow up with update() to ended+resuming.
    sessionManager.register({ id: OLD_SESSION, cwd: CWD, sessionFile, source: "terminal" });
    sessionManager.update(OLD_SESSION, { status: "ended", resuming: true });
    expect(sessionManager.get(OLD_SESSION)?.resuming).toBe(true);

    // 2. Record a pending resume for the cwd (mirrors handleSendPrompt auto-resume path)
    browserGateway.pendingResumeRegistry.record(CWD, {
      text: "continue from here",
      oldSessionId: OLD_SESSION,
      sessionFile,
    });

    // 3. A new session with the same cwd registers (the resumed pi process connecting back)
    const newBridgeWs = new WebSocket(`ws://127.0.0.1:${piPort}`);
    await new Promise<void>((resolve, reject) => {
      newBridgeWs.on("error", reject);
      newBridgeWs.on("open", () => {
        newBridgeWs.send(JSON.stringify({
          type: "session_register",
          sessionId: NEW_SESSION,
          cwd: CWD,
          source: "cli",
        }));
        newBridgeWs.send(JSON.stringify({ type: "replay_complete", sessionId: NEW_SESSION }));
        resolve();
      });
    });
    await wait(200); // let event-wiring process

    // 4. OLD session's resuming flag must now be false
    expect(
      sessionManager.get(OLD_SESSION)?.resuming,
      `Old session ${OLD_SESSION} should have resuming:false after new session registered`,
    ).toBe(false);

    // 5. NEW session must not have a spurious resuming:false (it never had resuming:true)
    //    New session's resuming should be undefined (never set).
    const newResuming = sessionManager.get(NEW_SESSION)?.resuming;
    expect(
      newResuming,
      `New session ${NEW_SESSION} should not have resuming set; got ${newResuming}`,
    ).toBeFalsy();

    newBridgeWs.close();
  });
});
