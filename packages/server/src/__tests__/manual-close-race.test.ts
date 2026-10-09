/**
 * Dashboard Stop / force-kill racing the bridge's own `session_unregister`.
 *
 * `shutdownSession` used to write `closedReason:"manual"` to DISK only, then
 * signal pi; the bridge answers with `session_unregister` before the server's
 * own unregister, which ended the in-memory session as `unknown` and the end
 * write relabelled the sidecar. With shutdown-window evidence that would make
 * a deliberate Stop look like a host shutdown. The in-memory session must be
 * `manual` before pi is signalled.
 * See change: fix-recovery-pi-signal-unregister (test-plan #E18).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("manual close vs racing bridge unregister", () => {
  let server: DashboardServer;
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
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-manual-race-"));
  });

  afterEach(async () => {
    try { await server.stop(); } catch { /* already stopped */ }
  });

  /**
   * A pi bridge backed by a real process (so the server has a pid to await):
   * on the server's `shutdown` it sends `session_unregister` and then exits,
   * exactly the order a graceful pi follows.
   */
  async function racingBridge(sessionId: string, sessionFile: string): Promise<{ ws: WebSocket; pi: ChildProcess }> {
    const pi = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
    const ws = new WebSocket(`ws://127.0.0.1:${server.piPort()}`);
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "shutdown" && msg.sessionId === sessionId) {
        ws.send(JSON.stringify({ type: "session_unregister", sessionId }));
        setTimeout(() => pi.kill("SIGKILL"), 50);
      }
    });
    await new Promise<void>((resolve) => {
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "session_register", sessionId, cwd: tmpDir, source: "cli", sessionFile, pid: pi.pid }));
        ws.send(JSON.stringify({ type: "replay_complete", sessionId }));
        ws.send(JSON.stringify({ type: "event_forward", sessionId, event: { eventType: "message_start", timestamp: Date.now(), data: {} } }));
        setTimeout(resolve, 120);
      });
    });
    return { ws, pi };
  }

  async function browserSend(msg: Record<string, unknown>): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${server.httpPort()}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });
    ws.send(JSON.stringify(msg));
    return ws;
  }

  it.each(["shutdown", "force_kill"])("%s stays manual and writes no shutdown evidence", async (type) => {
    const SID = `race-${type}`;
    const sf = path.join(tmpDir, `${SID}.jsonl`);
    writeFileSync(sf, "");
    const { ws, pi } = await racingBridge(SID, sf);
    expect(server.sessionManager.get(SID)?.pid).toBe(pi.pid);
    expect(readSessionMeta(sf)?.live).toBe(true);

    const browser = await browserSend({ type, sessionId: SID });
    await wait(1500);

    expect(server.sessionManager.get(SID)?.closedReason).toBe("manual");
    const meta = readSessionMeta(sf);
    expect(meta?.live).toBe(false);
    expect(meta?.closedReason).toBe("manual");
    expect(meta?.liveEpoch).toBeUndefined();
    pi.kill("SIGKILL");
    ws.close();
    browser.close();
  });
});

// Review B1 (round 1): force-kill closes the bridge socket itself, so the WS
// case above never delivers a racing unregister. Model the real interleaving
// deterministically: an unregister already queued on the socket is drained as
// `closeSession` closes it. Without the in-memory `manual` pre-stamp, that
// unregister ends the session `unknown` + bridge-tagged — the exact state the
// end write turns into shutdown-window evidence, durable until the final
// `update` lands (a crash in between leaves it on disk).
describe("force-kill vs a bridge unregister drained at socket close", () => {
  it("no ending is ever observed as an evidence-eligible bridge unregister", async () => {
    const { createMemorySessionManager } = await import("../session/memory-session-manager.js");
    const { forceKillSession } = await import("../browser-handlers/session-action-handler.js");
    const sm = createMemorySessionManager();
    sm.register({ id: "fk", cwd: "/w", source: "cli", sessionFile: "/w/fk.jsonl" } as unknown as Parameters<typeof sm.register>[0]);
    const endings: Array<{ reason: string | undefined; bridgeTagged: boolean }> = [];
    sm.onEnded = (id) => endings.push({ reason: sm.get(id)?.closedReason, bridgeTagged: sm.wasEndedByBridgeUnregister(id) });

    await forceKillSession("fk", {
      sessionManager: sm,
      piGateway: { closeSession: (id: string) => sm.unregister(id, { endSource: "bridge_unregister" }) },
      headlessPidRegistry: { killBySessionId: async () => false },
      broadcast: () => {},
    } as unknown as Parameters<typeof forceKillSession>[1]);

    expect(endings.length).toBeGreaterThan(0);
    expect(endings.filter((e) => e.bridgeTagged && e.reason === "unknown")).toEqual([]);
    expect(sm.get("fk")?.closedReason).toBe("manual");
  });
});
