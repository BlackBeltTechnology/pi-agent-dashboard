/**
 * Eager liveness-marker stamping at the turn boundary (event-wiring).
 * Asserts `{ live:true, liveEpoch }` lands in `.meta.json` on the first live
 * activity event and stays put across subsequent same-epoch events (the
 * once-per-activation guard makes repeat events idempotent at the marker).
 * See change: reopen-sessions-after-shutdown.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { createServer, type DashboardServer } from "../server.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("liveness-stamp wiring", () => {
  let server: DashboardServer;
  let piPort: number;
  let tmpDir: string;

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
    piPort = server.piPort()!;
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-liveness-"));
  });

  afterEach(async () => {
    try { await server.stop(); } catch { /* already stopped */ }
  });

  async function register(sessionId: string, sessionFile: string): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
    await new Promise<void>((resolve) => {
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "session_register", sessionId, cwd: tmpDir, source: "cli", sessionFile }));
        ws.send(JSON.stringify({ type: "replay_complete", sessionId }));
        setTimeout(resolve, 60);
      });
    });
    return ws;
  }

  function activity(ws: WebSocket, sessionId: string, eventType: string): void {
    ws.send(JSON.stringify({ type: "event_forward", sessionId, event: { eventType, timestamp: Date.now(), data: {} } }));
  }

  it("stamps live:true + liveEpoch on first activity and keeps it across same-epoch events", async () => {
    const SID = "live-sess";
    const sessionFile = path.join(tmpDir, `${SID}.jsonl`);
    writeFileSync(sessionFile, "");

    const ws = await register(SID, sessionFile);
    activity(ws, SID, "message_start");
    await wait(120);

    const meta1 = readSessionMeta(sessionFile);
    expect(meta1?.live).toBe(true);
    expect(typeof meta1?.liveEpoch).toBe("number");
    const epoch = meta1!.liveEpoch;

    // Subsequent same-epoch activity events must not flip or drop the marker.
    activity(ws, SID, "tool_execution_start");
    activity(ws, SID, "turn_end");
    await wait(120);

    const meta2 = readSessionMeta(sessionFile);
    expect(meta2?.live).toBe(true);
    expect(meta2?.liveEpoch).toBe(epoch);

    ws.close();
  });

  it("clean server stop() clears live:false without closedReason for running sessions", async () => {
    const SID = "live-stop";
    const sessionFile = path.join(tmpDir, `${SID}.jsonl`);
    writeFileSync(sessionFile, "");

    const ws = await register(SID, sessionFile);
    activity(ws, SID, "message_start");
    await wait(120);
    expect(readSessionMeta(sessionFile)?.live).toBe(true);
    ws.close();

    // Clean teardown (idle / app quit) is intentional.
    await server.stop();
    const meta = readSessionMeta(sessionFile);
    expect(meta?.live).toBe(false);
    expect(meta?.closedReason).toBeUndefined();
  });

  it("explicit unregister eagerly clears live:false; same-boot re-register re-stamps live:true", async () => {
    const SID = "live-requick";
    const sessionFile = path.join(tmpDir, `${SID}.jsonl`);
    writeFileSync(sessionFile, "");

    // 1. Run → stamped live.
    const ws = await register(SID, sessionFile);
    activity(ws, SID, "message_start");
    await wait(120);
    expect(readSessionMeta(sessionFile)?.live).toBe(true);

    // 2. Clean quit (explicit unregister). The liveness clear must be EAGER —
    //    durable well within the 1000ms debounce window of the stats path.
    ws.send(JSON.stringify({ type: "session_unregister", sessionId: SID }));
    await wait(150);
    const afterQuit = readSessionMeta(sessionFile);
    expect(afterQuit?.live).toBe(false);
    expect(afterQuit?.closedReason).toBeUndefined();

    // 3. Same-boot resume of the SAME session id: the register-side guard
    //    reset means activity re-stamps live:true (otherwise a later crash
    //    misses recovery).
    const ws2 = await register(SID, sessionFile);
    activity(ws2, SID, "message_start");
    await wait(150);
    expect(readSessionMeta(sessionFile)?.live).toBe(true);
    ws2.close();
  });

  it("does not stamp liveness for non-activity events alone", async () => {
    const SID = "live-noop";
    const sessionFile = path.join(tmpDir, `${SID}.jsonl`);
    writeFileSync(sessionFile, "");

    const ws = await register(SID, sessionFile);
    activity(ws, SID, "process_metrics");
    activity(ws, SID, "git_info_update");
    await wait(120);

    expect(readSessionMeta(sessionFile)?.live).toBeUndefined();
    ws.close();
  });
});
