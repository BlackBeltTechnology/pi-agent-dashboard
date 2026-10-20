/**
 * SPIKE (throwaway) — fix-large-session-resume-replay. Reproduces the
 * proposal's root causes against a real server. Delete after planning.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createServer, type DashboardServer } from "../server.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function openBridge(piPort: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
    ws.on("error", reject);
    ws.on("open", () => resolve(ws));
  });
}
function openBrowser(port: number): Promise<{ ws: WebSocket; msgs: any[] }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const msgs: any[] = [];
    ws.on("message", (raw) => { try { msgs.push(JSON.parse(raw.toString())); } catch { /* */ } });
    ws.on("open", () => setTimeout(() => resolve({ ws, msgs }), 30));
  });
}
const send = (ws: WebSocket, m: unknown) => ws.send(JSON.stringify(m));
const writeEv = (sid: string, change: string) => ({
  type: "event_forward", sessionId: sid,
  event: { eventType: "tool_execution_start", timestamp: Date.now(),
    data: { toolName: "Write", toolCallId: `c-${change}`, args: { path: `openspec/changes/${change}/proposal.md` } } },
});
const filler = (sid: string, i: number) => ({
  type: "event_forward", sessionId: sid,
  event: { eventType: "message_end", timestamp: Date.now(),
    data: { message: { role: "user", content: [{ type: "text", text: `msg ${i}` }] } } },
});

describe("SPIKE fix-large-session-resume-replay", () => {
  let server: DashboardServer;
  let piPort: number;
  let port: number;
  const open: WebSocket[] = [];
  beforeEach(async () => {
    server = await createServer({ port: 0, piPort: 0, host: "127.0.0.1", dev: true, autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false });
    await server.start();
    port = server.httpPort()!; piPort = server.piPort()!;
  });
  afterEach(async () => { for (const w of open) w.close(); open.length = 0; await server.stop(); });

  it("S1 #928: replay slower than 5s leaks history as live → pendingReplaceProposal set, survives replay_complete", async () => {
    const b = await openBridge(piPort); open.push(b);
    send(b, { type: "session_register", sessionId: "s1", cwd: "/tmp", source: "cli", eventCount: 2 });
    await wait(50);
    server.sessionManager.update("s1", { name: "custom", attachedProposal: "change-a" } as any);
    const { ws: br, msgs } = await openBrowser(port); open.push(br);
    const before = server.sessionManager.get("s1")?.lastActivityAt;
    send(b, filler("s1", 0));
    await wait(5_300); // replay still streaming past the absolute 5 s timeout
    send(b, writeEv("s1", "change-b")); // historical event, part of the same replay
    await wait(150);
    send(b, { type: "replay_complete", sessionId: "s1" });
    await wait(150);
    const s = server.sessionManager.get("s1") as any;
    const pendingBroadcasts = msgs.filter((m) => m.type === "session_updated" && m.updates?.pendingReplaceProposal === "change-b").length;
    console.log("[S1]", JSON.stringify({ pendingReplaceProposal: s?.pendingReplaceProposal, pendingBroadcasts, lastActivityBumped: s?.lastActivityAt !== before, unread: s?.unread }));
    expect(s?.pendingReplaceProposal).toBe("change-b"); // BUG reproduced if this passes
  }, 15_000);

  it("S1b #928 realistic: replay keeps streaming for >5 s (no idle gap) then a historical Write", async () => {
    const b = await openBridge(piPort); open.push(b);
    send(b, { type: "session_register", sessionId: "s1b", cwd: "/tmp", source: "cli", eventCount: 2 });
    await wait(50);
    server.sessionManager.update("s1b", { name: "custom", attachedProposal: "change-a" } as any);
    for (let i = 0; i < 13; i++) { send(b, filler("s1b", i)); await wait(450); } // ~5.9 s of continuous replay
    send(b, writeEv("s1b", "change-b"));
    await wait(150);
    send(b, { type: "replay_complete", sessionId: "s1b" });
    await wait(150);
    const s = server.sessionManager.get("s1b") as any;
    console.log("[S1b]", JSON.stringify({ pendingReplaceProposal: s?.pendingReplaceProposal }));
  }, 15_000);

  it("S2: stale 5s timer from an earlier register ends a LATER register's replay early", async () => {
    const b = await openBridge(piPort); open.push(b);
    send(b, { type: "session_register", sessionId: "s2", cwd: "/tmp", source: "cli" });
    await wait(50);
    send(b, { type: "replay_complete", sessionId: "s2" });
    server.sessionManager.update("s2", { name: "custom", attachedProposal: "change-a" } as any);
    await wait(4_000);
    send(b, { type: "session_register", sessionId: "s2", cwd: "/tmp", source: "cli" }); // reconnect, replay #2 starts
    await wait(1_300); // first timer fired at t≈5.05s; second replay only 1.3 s old
    send(b, writeEv("s2", "change-b"));
    await wait(150);
    const s = server.sessionManager.get("s2") as any;
    console.log("[S2]", JSON.stringify({ pendingReplaceProposal: s?.pendingReplaceProposal }));
    expect(s?.pendingReplaceProposal).toBe("change-b"); // BUG reproduced if this passes
  }, 15_000);

  it("S3 #929 F2: replay_complete flush is ONE unwindowed event_replay frame", async () => {
    const N = 3_000; // > default maxReplayEvents (2000)
    const b = await openBridge(piPort); open.push(b);
    const { ws: br, msgs } = await openBrowser(port); open.push(br);
    send(b, { type: "session_register", sessionId: "s3", cwd: "/tmp", source: "cli", eventCount: N });
    await wait(50);
    send(br, { type: "subscribe", sessionId: "s3" });
    await wait(100);
    msgs.length = 0;
    for (let i = 0; i < N; i++) send(b, filler("s3", i));
    send(b, { type: "replay_complete", sessionId: "s3" });
    await wait(1_500);
    const replays = msgs.filter((m) => m.type === "event_replay");
    const sizes = replays.map((m) => m.events.length);
    const windows = msgs.filter((m) => m.type === "history_window").length;
    const bytes = replays.reduce((a, m) => a + JSON.stringify(m).length, 0);
    console.log("[S3]", JSON.stringify({ frames: replays.length, sizes, historyWindow: windows, bytes }));
    expect(Math.max(...sizes)).toBeGreaterThan(2_000);
  }, 15_000);

  it("S4 #929 F3: cold-hydrated session still wipes on a register with the same entry count", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "spike-resume-"));
    const file = path.join(dir, "s4.jsonl");
    const lines = [{ type: "session", id: "s4", cwd: dir, version: 3, timestamp: new Date().toISOString() }];
    let parent: string | null = null;
    for (let i = 0; i < 6; i++) {
      const id = `e${i}`;
      lines.push({ type: "message", id, parentId: parent, timestamp: new Date().toISOString(),
        message: { role: i % 2 ? "assistant" : "user", content: [{ type: "text", text: `t${i}` }], ...(i % 2 ? { usage: {} , model: "m", provider: "p", stopReason: "stop" } : {}) } } as any);
      parent = id;
    }
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    server.sessionManager.register({ id: "s4", cwd: dir, sessionFile: file, source: "terminal" } as any);
    server.sessionManager.update("s4", { status: "ended" } as any);
    const { ws: br, msgs } = await openBrowser(port); open.push(br);
    send(br, { type: "subscribe", sessionId: "s4" });
    await wait(1_500);
    const hydrated = server.eventStore.getEvents("s4", 1).length;
    const lastEntryCount = (server.sessionManager.get("s4") as any)?.lastEntryCount;
    msgs.length = 0;
    const b = await openBridge(piPort); open.push(b);
    send(b, { type: "session_register", sessionId: "s4", cwd: dir, source: "cli", sessionFile: file, eventCount: 6 });
    await wait(150);
    const resets = msgs.filter((m) => m.type === "session_state_reset").length;
    console.log("[S4]", JSON.stringify({ hydratedEvents: hydrated, lastEntryCountAfterHydration: lastEntryCount, resetsOnRegister: resets, storeAfterRegister: server.eventStore.getEvents("s4", 1).length }));
    expect(hydrated).toBeGreaterThan(0);
    expect(resets).toBeGreaterThan(0); // BUG reproduced: wipe not skipped
  }, 15_000);

  it("S5 #929 R: in-flight cold hydration lands on top of a bridge replay", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "spike-race-"));
    const file = path.join(dir, "s5.jsonl");
    const E = 20_000;
    const out: string[] = [JSON.stringify({ type: "session", id: "s5", cwd: dir, version: 3, timestamp: new Date().toISOString() })];
    let parent: string | null = null;
    for (let i = 0; i < E; i++) {
      const id = `e${i}`;
      out.push(JSON.stringify({ type: "message", id, parentId: parent, timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "text", text: `t${i} `.repeat(20) }] } }));
      parent = id;
    }
    writeFileSync(file, out.join("\n") + "\n");
    server.sessionManager.register({ id: "s5", cwd: dir, sessionFile: file, source: "terminal" } as any);
    server.sessionManager.update("s5", { status: "ended" } as any);
    const { ws: br } = await openBrowser(port); open.push(br);
    send(br, { type: "subscribe", sessionId: "s5" });
    await wait(20); // hydration now in flight
    const b = await openBridge(piPort); open.push(b);
    send(b, { type: "session_register", sessionId: "s5", cwd: dir, source: "cli", sessionFile: file, eventCount: E });
    for (let i = 0; i < 50; i++) send(b, filler("s5", i));
    send(b, { type: "replay_complete", sessionId: "s5" });
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < 10_000) { await wait(200); n = server.eventStore.getEvents("s5", 1).length; if (n > 50) break; }
    await wait(300);
    n = server.eventStore.getEvents("s5", 1).length;
    console.log("[S5]", JSON.stringify({ storeCount: n, bridgeReplayed: 50, hydratedOnTop: n > 50 }));
  }, 20_000);
});
