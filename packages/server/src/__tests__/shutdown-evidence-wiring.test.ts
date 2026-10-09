/**
 * Shutdown-window evidence: the eager end write carries `liveEpoch` (the boot
 * the session ENDED in) + `endedAt` only when the end came from the bridge's
 * explicit `session_unregister`. Every other ending writes today's
 * `{ live:false, closedReason }` with no `liveEpoch`.
 * See change: fix-recovery-pi-signal-unregister (D2).
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSessionMeta, writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { readBootState } from "../persistence/boot-state.js";
import { createServer, type DashboardServer } from "../server.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const OLD_BOOT = 1_700_000_000_000;

describe("shutdown-window evidence wiring", () => {
  let server: DashboardServer;
  let piPort: number;
  let tmpDir: string;
  let currentBoot: number;

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
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-shutdown-evidence-"));
    currentBoot = readBootState()!.bootId;
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

  function activity(ws: WebSocket, sessionId: string): void {
    ws.send(JSON.stringify({ type: "event_forward", sessionId, event: { eventType: "message_start", timestamp: Date.now(), data: {} } }));
  }

  function newSessionFile(sid: string): string {
    const f = path.join(tmpDir, `${sid}.jsonl`);
    writeFileSync(f, "");
    return f;
  }

  // test-plan #E12 — ending boot, not the boot it was last stamped under.
  it("bridge unregister writes live:false + the ENDING boot's liveEpoch + endedAt immediately", async () => {
    const SID = "ev-bridge";
    const sf = newSessionFile(SID);
    // Last activated under an earlier boot; no activity in this boot.
    writeSessionMeta(sf, { live: true, liveEpoch: OLD_BOOT });
    const ws = await register(SID, sf);
    const before = Date.now();
    ws.send(JSON.stringify({ type: "session_unregister", sessionId: SID }));
    await wait(150); // well inside the 1000 ms debounce
    const meta = readSessionMeta(sf);
    expect(meta?.live).toBe(false);
    expect(meta?.closedReason).toBe("unknown");
    expect(meta?.liveEpoch).toBe(currentBoot);
    expect(meta?.endedAt).toBeGreaterThanOrEqual(before);
    ws.close();
  });

  // test-plan #E13 — every non-bridge ending leaves no liveEpoch.
  it.each([
    ["heartbeat / reconnect-grace expiry", (s: DashboardServer, id: string) => s.sessionManager.unregister(id, { witnessed: false, closedReason: "unknown" })],
    ["process gone (carrier loss)", (s: DashboardServer, id: string) => s.sessionManager.unregister(id, { witnessed: false, closedReason: "process_gone" })],
    ["same-tick history cleanup", (s: DashboardServer, id: string) => s.sessionManager.unregister(id, { witnessed: false })],
    ["placeholder / finalize-on-close / ghost cleanup", (s: DashboardServer, id: string) => s.sessionManager.unregister(id)],
    ["manual close", (s: DashboardServer, id: string) => s.sessionManager.unregister(id, { closedReason: "manual" })],
    ["spawn failure", (s: DashboardServer, id: string) => s.sessionManager.update(id, { status: "ended", closedReason: "spawn_failed" })],
    ["relocation (session_moved)", (s: DashboardServer, id: string) => s.sessionManager.update(id, { status: "ended", endedAt: Date.now(), movedTo: "other-instance" } as never)],
  ])("%s writes live:false with no liveEpoch", async (_label, end) => {
    const SID = `ev-other-${Math.random().toString(36).slice(2, 8)}`;
    const sf = newSessionFile(SID);
    const ws = await register(SID, sf);
    activity(ws, SID);
    await wait(120);
    expect(readSessionMeta(sf)?.liveEpoch).toBe(currentBoot); // live stamp
    end(server, SID);
    await wait(150);
    const meta = readSessionMeta(sf);
    expect(meta?.live).toBe(false);
    expect(meta?.liveEpoch).toBeUndefined();
    ws.close();
  });

  // test-plan #E14 — a re-fire of onEnded never moves the evidence to another epoch.
  it("reason re-fire keeps the evidence while unknown and drops it once refined", async () => {
    const SID = "ev-refire";
    const sf = newSessionFile(SID);
    const ws = await register(SID, sf);
    ws.send(JSON.stringify({ type: "session_unregister", sessionId: SID }));
    await wait(150);
    const first = readSessionMeta(sf);
    expect(first?.liveEpoch).toBe(currentBoot);

    // (a) a re-fire with the reason still `unknown` rewrites the same evidence.
    // `update()` only re-fires on a reason CHANGE, so invoke the wired callback.
    server.sessionManager.onEnded?.(SID);
    await wait(150);
    const again = readSessionMeta(sf);
    expect(again?.liveEpoch).toBe(currentBoot);
    expect(again?.endedAt).toBe(first?.endedAt);

    // (b) a refined reason re-fires onEnded: evidence dropped, never re-dated.
    server.sessionManager.update(SID, { closedReason: "process_gone" });
    await wait(150);
    const refined = readSessionMeta(sf);
    expect(refined?.closedReason).toBe("process_gone");
    expect(refined?.liveEpoch).toBeUndefined();
    expect(refined?.endedAt).toBe(first?.endedAt);
    ws.close();
  });

  // test-plan #E15 — a session restored from an earlier boot is never re-stamped.
  it("an ended session restored from an earlier boot never gets this boot's epoch", async () => {
    const SID = "ev-restored";
    const sf = newSessionFile(SID);
    writeSessionMeta(sf, { live: false, liveEpoch: OLD_BOOT, endedAt: 1234, closedReason: "unknown", status: "ended" });
    server.sessionManager.restore({
      id: SID, cwd: tmpDir, source: "cli", status: "ended", startedAt: 1000, endedAt: 1234,
      closedReason: "unknown", sessionFile: sf,
    } as never);
    server.sessionManager.update(SID, { status: "ended", closedReason: "process_gone" });
    await wait(150);
    expect(readSessionMeta(sf)?.liveEpoch).not.toBe(currentBoot);
  });

  // test-plan #X3 — reload: unregister, re-register, activity → the live:true
  // marker supersedes the evidence (one path, no duplicate).
  it("reload re-activation replaces the evidence with the live marker", async () => {
    const SID = "ev-reload";
    const sf = newSessionFile(SID);
    const ws = await register(SID, sf);
    activity(ws, SID);
    await wait(120);
    ws.send(JSON.stringify({ type: "session_unregister", sessionId: SID }));
    await wait(150);
    expect(readSessionMeta(sf)?.live).toBe(false);
    const ws2 = await register(SID, sf);
    activity(ws2, SID);
    await wait(150);
    const meta = readSessionMeta(sf);
    expect(meta?.live).toBe(true);
    expect(meta?.liveEpoch).toBe(currentBoot);
    expect(server.sessionManager.wasEndedByBridgeUnregister(SID)).toBe(false);
    ws.close();
    ws2.close();
  });
});
