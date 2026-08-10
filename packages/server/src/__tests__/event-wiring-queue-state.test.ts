/**
 * Tests for the `queue_update` extension-to-server message handling.
 * Validates that the server caches Session.pendingQueues wholesale and
 * broadcasts session_updated to subscribers.
 * See change: add-followup-edit-and-steer-cancel.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createServer, type DashboardServer } from "../server.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("event-wiring: queue_update caches Session.pendingQueues and broadcasts", () => {
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

  it("wholesale replaces Session.pendingQueues on each queue_update event", async () => {
    const { sessionManager } = server;
    const SID = "queue-test-sess";
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-queue-test-"));
    const sessionFile = path.join(tmpDir, "s.jsonl");
    writeFileSync(sessionFile, "");

    const bridgeWs = new WebSocket(`ws://127.0.0.1:${piPort}`);
    await new Promise<void>((resolve, reject) => {
      bridgeWs.on("error", reject);
      bridgeWs.on("open", () => {
        bridgeWs.send(JSON.stringify({
          type: "session_register",
          sessionId: SID,
          cwd: tmpDir,
          source: "cli",
          sessionFile,
        }));
        bridgeWs.send(JSON.stringify({ type: "replay_complete", sessionId: SID }));
        resolve();
      });
    });
    await wait(80);

    // Initial state: queues start empty after register.
    expect(sessionManager.get(SID)?.pendingQueues).toEqual({ steering: [], followUp: [] });

    // 1. Bridge emits queue_update with steering only
    bridgeWs.send(JSON.stringify({
      type: "queue_update",
      sessionId: SID,
      steering: ["first"],
      followUp: [],
    }));
    await wait(60);
    expect(sessionManager.get(SID)?.pendingQueues).toEqual({ steering: ["first"], followUp: [] });

    // 2. Bridge emits queue_update with both queues populated — wholesale replace
    bridgeWs.send(JSON.stringify({
      type: "queue_update",
      sessionId: SID,
      steering: ["alpha", "beta"],
      followUp: ["wrap up"],
    }));
    await wait(60);
    expect(sessionManager.get(SID)?.pendingQueues).toEqual({
      steering: ["alpha", "beta"],
      followUp: ["wrap up"],
    });

    // 3. Bridge emits empty snapshot (drain finished or clear ran)
    bridgeWs.send(JSON.stringify({
      type: "queue_update",
      sessionId: SID,
      steering: [],
      followUp: [],
    }));
    await wait(60);
    expect(sessionManager.get(SID)?.pendingQueues).toEqual({ steering: [], followUp: [] });

    bridgeWs.close();
  });

  it("resets Session.pendingQueues to empty on session re-register", async () => {
    const { sessionManager } = server;
    const SID = "queue-rereg-sess";
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-queue-rereg-"));
    const sessionFile = path.join(tmpDir, "s.jsonl");
    writeFileSync(sessionFile, "");

    // First bridge connects and populates the queues.
    const ws1 = new WebSocket(`ws://127.0.0.1:${piPort}`);
    await new Promise<void>((resolve) => {
      ws1.on("open", () => {
        ws1.send(JSON.stringify({
          type: "session_register",
          sessionId: SID,
          cwd: tmpDir,
          source: "cli",
          sessionFile,
        }));
        ws1.send(JSON.stringify({ type: "replay_complete", sessionId: SID }));
        ws1.send(JSON.stringify({
          type: "queue_update",
          sessionId: SID,
          steering: ["a", "b"],
          followUp: ["c"],
        }));
        setTimeout(resolve, 100);
      });
    });
    expect(sessionManager.get(SID)?.pendingQueues?.steering).toHaveLength(2);
    expect(sessionManager.get(SID)?.pendingQueues?.followUp).toHaveLength(1);
    ws1.close();
    await wait(80);

    // Second bridge re-registers same sessionId — pendingQueues MUST reset.
    const ws2 = new WebSocket(`ws://127.0.0.1:${piPort}`);
    await new Promise<void>((resolve) => {
      ws2.on("open", () => {
        ws2.send(JSON.stringify({
          type: "session_register",
          sessionId: SID,
          cwd: tmpDir,
          source: "cli",
          sessionFile,
        }));
        ws2.send(JSON.stringify({ type: "replay_complete", sessionId: SID }));
        setTimeout(resolve, 100);
      });
    });
    expect(sessionManager.get(SID)?.pendingQueues).toEqual({ steering: [], followUp: [] });
    ws2.close();
  });
});
